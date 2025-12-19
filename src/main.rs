use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::{sqlite::SqlitePoolOptions, Pool, Row, Sqlite};
use std::{env, sync::Arc};
use thiserror::Error;
use time::OffsetDateTime;
use tower_http::trace::TraceLayer;
use tracing::info;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
struct AppState {
    db: Pool<Sqlite>,
    server_secret: Vec<u8>,
    default_ttl_days: i64,
    max_ttl_days: i64,
    max_msg_bytes: usize,
    max_queue_bytes: i64,
    poll_limit_default: i64,
    poll_limit_max: i64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://mailbox.db".into());
    let bind_addr = env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let server_secret = env::var("SERVER_SECRET")
        .expect("SERVER_SECRET is required (recommend 32+ bytes)")
        .into_bytes();

    let default_ttl_days = env_i64("DEFAULT_TTL_DAYS", 7);
    let max_ttl_days = env_i64("MAX_TTL_DAYS", 14);
    let max_msg_bytes = env_usize("MAX_MSG_BYTES", 16_384);
    let max_queue_bytes = env_i64("MAX_QUEUE_BYTES", 10_485_760);
    let poll_limit_default = env_i64("POLL_LIMIT_DEFAULT", 20);
    let poll_limit_max = env_i64("POLL_LIMIT_MAX", 50);

    let db = SqlitePoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;
    sqlx::query("PRAGMA journal_mode = WAL;")
        .execute(&db)
        .await?;

    sqlx::migrate!("./migrations").run(&db).await?;

    // background TTL purge (best-effort)
    {
        let db_clone = db.clone();
        tokio::spawn(async move {
            loop {
                let now = unix_ts();
                let _ = sqlx::query("DELETE FROM messages WHERE expires_at <= ?")
                    .bind(now)
                    .execute(&db_clone)
                    .await;
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            }
        });
    }

    let state = AppState {
        db,
        server_secret,
        default_ttl_days,
        max_ttl_days,
        max_msg_bytes,
        max_queue_bytes,
        poll_limit_default,
        poll_limit_max,
    };

    let app = Router::new()
        .route("/v1/mailboxes", post(create_mailbox))
        .route(
            "/v1/mailboxes/:mailbox_id/deposit-tokens",
            post(register_deposit_tokens),
        )
        .route("/v1/mailboxes/:mailbox_id/deposit", post(deposit))
        .route("/v1/mailboxes/:mailbox_id/poll", get(poll))
        .route("/v1/mailboxes/:mailbox_id/ack", post(ack))
        .route("/v1/mailboxes/:mailbox_id/revoke", post(revoke))
        .layer(TraceLayer::new_for_http())
        .with_state(Arc::new(state));

    info!("listening on {}", bind_addr);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn env_i64(key: &str, default: i64) -> i64 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}
fn env_usize(key: &str, default: usize) -> usize {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}
fn unix_ts() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}

#[derive(Error, Debug)]
enum ApiError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("not found")]
    NotFound,
    #[error("invalid input")]
    InvalidInput,
    #[error("payload too large")]
    PayloadTooLarge,
    #[error("rate limited")]
    RateLimited,
    #[error("conflict")]
    Conflict,
    #[error("server error")]
    ServerError,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden => StatusCode::FORBIDDEN,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::InvalidInput => StatusCode::BAD_REQUEST,
            ApiError::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            ApiError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            ApiError::Conflict => StatusCode::CONFLICT,
            ApiError::ServerError => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(serde_json::json!({ "error": self.to_string() }))).into_response()
    }
}

fn bearer_token(headers: &HeaderMap) -> Result<String, ApiError> {
    let auth = headers.get("authorization").ok_or(ApiError::Unauthorized)?;
    let auth = auth.to_str().map_err(|_| ApiError::Unauthorized)?;
    let parts: Vec<&str> = auth.split_whitespace().collect();
    if parts.len() != 2 || parts[0].to_lowercase() != "bearer" {
        return Err(ApiError::Unauthorized);
    }
    Ok(parts[1].to_string())
}

fn hmac_hash(server_secret: &[u8], token: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(server_secret).expect("HMAC key");
    mac.update(token);
    mac.finalize().into_bytes().to_vec()
}

fn b64url_decode(s: &str) -> Result<Vec<u8>, ApiError> {
    URL_SAFE_NO_PAD
        .decode(s.as_bytes())
        .map_err(|_| ApiError::InvalidInput)
}
fn b64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn random_b64url(nbytes: usize) -> String {
    let mut buf = vec![0u8; nbytes];
    rand::thread_rng().fill_bytes(&mut buf);
    b64url_encode(&buf)
}

// Cursor = base64url( last_id (8 bytes LE) || mac(32 bytes) )
// mac = HMAC(server_secret, "cursor" || mailbox_id || last_id_bytes)
fn cursor_encode(server_secret: &[u8], mailbox_id: &str, last_id: i64) -> String {
    let last = (last_id as u64).to_le_bytes();
    let mut mac = HmacSha256::new_from_slice(server_secret).unwrap();
    mac.update(b"cursor");
    mac.update(mailbox_id.as_bytes());
    mac.update(&last);
    let tag = mac.finalize().into_bytes();

    let mut out = Vec::with_capacity(8 + 32);
    out.extend_from_slice(&last);
    out.extend_from_slice(&tag);
    b64url_encode(&out)
}

fn cursor_decode(server_secret: &[u8], mailbox_id: &str, cursor: &str) -> Result<i64, ApiError> {
    let raw = b64url_decode(cursor)?;
    if raw.len() != 40 {
        return Err(ApiError::InvalidInput);
    }
    let (last_bytes, tag) = raw.split_at(8);

    let mut mac = HmacSha256::new_from_slice(server_secret).unwrap();
    mac.update(b"cursor");
    mac.update(mailbox_id.as_bytes());
    mac.update(last_bytes);
    mac.verify_slice(tag).map_err(|_| ApiError::InvalidInput)?;

    let mut arr = [0u8; 8];
    arr.copy_from_slice(last_bytes);
    let last_id = u64::from_le_bytes(arr) as i64;
    Ok(last_id)
}

#[derive(Deserialize)]
struct CreateMailboxReq {
    poll_token: Option<String>,
}

#[derive(Serialize)]
struct Limits {
    max_msg_bytes: usize,
    max_queue_bytes: i64,
    ttl_days: i64,
}

#[derive(Serialize)]
struct CreateMailboxResp {
    mailbox_id: String,
    poll_token: Option<String>,
    limits: Limits,
}

async fn create_mailbox(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateMailboxReq>,
) -> Result<Json<CreateMailboxResp>, ApiError> {
    let now = unix_ts();
    let mailbox_id = random_b64url(24);

    let (poll_token, poll_hash) = match req.poll_token {
        Some(t) => {
            let raw = b64url_decode(&t)?;
            if raw.len() != 32 {
                return Err(ApiError::InvalidInput);
            }
            (None, hmac_hash(&state.server_secret, &raw))
        }
        None => {
            let mut raw = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut raw);
            let token_b64 = b64url_encode(&raw);
            (Some(token_b64), hmac_hash(&state.server_secret, &raw))
        }
    };

    sqlx::query("INSERT INTO mailboxes (mailbox_id, poll_hash, created_at) VALUES (?, ?, ?)")
        .bind(&mailbox_id)
        .bind(poll_hash)
        .bind(now)
        .execute(&state.db)
        .await
        .map_err(|_| ApiError::ServerError)?;

    Ok(Json(CreateMailboxResp {
        mailbox_id,
        poll_token,
        limits: Limits {
            max_msg_bytes: state.max_msg_bytes,
            max_queue_bytes: state.max_queue_bytes,
            ttl_days: state.default_ttl_days,
        },
    }))
}

#[derive(Deserialize)]
struct RegisterDepositTokensReq {
    deposit_tokens: Vec<String>, // base64url(32 bytes)
}

#[derive(Serialize)]
struct RegisterDepositTokensResp {
    added: u64,
}

async fn register_deposit_tokens(
    State(state): State<Arc<AppState>>,
    Path(mailbox_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<RegisterDepositTokensReq>,
) -> Result<Json<RegisterDepositTokensResp>, ApiError> {
    let token = bearer_token(&headers)?;
    let token_raw = b64url_decode(&token)?;
    if token_raw.len() != 32 {
        return Err(ApiError::Unauthorized);
    }
    let poll_hash = hmac_hash(&state.server_secret, &token_raw);

    let mb: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT poll_hash FROM mailboxes WHERE mailbox_id = ?")
            .bind(&mailbox_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| ApiError::ServerError)?;
    let Some((stored_hash,)) = mb else {
        return Err(ApiError::NotFound);
    };

    if stored_hash != poll_hash {
        return Err(ApiError::Forbidden);
    }

    if req.deposit_tokens.is_empty() || req.deposit_tokens.len() > 5000 {
        return Err(ApiError::InvalidInput);
    }

    let now = unix_ts();
    let mut added: u64 = 0;

    for t in req.deposit_tokens {
        let raw = b64url_decode(&t)?;
        if raw.len() != 32 {
            return Err(ApiError::InvalidInput);
        }
        let dep_hash = hmac_hash(&state.server_secret, &raw);

        let res = sqlx::query(
            "INSERT OR IGNORE INTO deposit_tokens (mailbox_id, dep_hash, revoked, created_at) VALUES (?, ?, 0, ?)",
        )
        .bind(&mailbox_id)
        .bind(dep_hash)
        .bind(now)
        .execute(&state.db)
        .await
        .map_err(|_| ApiError::ServerError)?;
        added += res.rows_affected();
    }

    Ok(Json(RegisterDepositTokensResp { added }))
}

fn header_msg_id(headers: &HeaderMap) -> Result<Vec<u8>, ApiError> {
    let v = headers
        .get("x-whisper-msgid")
        .ok_or(ApiError::InvalidInput)?
        .to_str()
        .map_err(|_| ApiError::InvalidInput)?;
    let raw = b64url_decode(v)?;
    if !(16..=32).contains(&raw.len()) {
        return Err(ApiError::InvalidInput);
    }
    Ok(raw)
}

fn header_expires_at(headers: &HeaderMap) -> Option<i64> {
    headers
        .get("x-whisper-expiresat")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse().ok())
}

#[derive(Serialize)]
struct DepositResp {
    stored: bool,
    msg_id: String,
    expires_at: i64,
}

async fn deposit(
    State(state): State<Arc<AppState>>,
    Path(mailbox_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DepositResp>, ApiError> {
    if body.len() > state.max_msg_bytes {
        return Err(ApiError::PayloadTooLarge);
    }

    // Auth deposit token
    let token = bearer_token(&headers)?;
    let token_raw = b64url_decode(&token)?;
    if token_raw.len() != 32 {
        return Err(ApiError::Unauthorized);
    }
    let dep_hash = hmac_hash(&state.server_secret, &token_raw);

    // mailbox exists?
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT mailbox_id FROM mailboxes WHERE mailbox_id = ?")
            .bind(&mailbox_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| ApiError::ServerError)?;
    if exists.is_none() {
        return Err(ApiError::NotFound);
    }

    // token valid & not revoked?
    let dep_ok: Option<(i64,)> = sqlx::query_as(
        "SELECT revoked FROM deposit_tokens WHERE mailbox_id = ? AND dep_hash = ?",
    )
    .bind(&mailbox_id)
    .bind(&dep_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::ServerError)?;
    match dep_ok {
        Some((revoked,)) if revoked == 0 => {}
        _ => return Err(ApiError::Forbidden),
    }

    // expires
    let now = unix_ts();
    let mut expires_at = header_expires_at(&headers)
        .unwrap_or_else(|| now + state.default_ttl_days * 24 * 3600);
    let max_expires = now + state.max_ttl_days * 24 * 3600;

    if expires_at > max_expires {
        expires_at = max_expires;
    }
    if expires_at <= now {
        return Err(ApiError::InvalidInput);
    }

    // queue bytes quota
    let (queue_bytes,): (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(LENGTH(blob)),0) as bytes FROM messages WHERE mailbox_id = ?",
    )
    .bind(&mailbox_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::ServerError)?;
    if queue_bytes + body.len() as i64 > state.max_queue_bytes {
        return Err(ApiError::RateLimited);
    }

    let msg_id_raw = header_msg_id(&headers)?;
    let msg_id_b64 = b64url_encode(&msg_id_raw);

    // Insert with idempotence
    let res = sqlx::query(
        "INSERT INTO messages (mailbox_id, msg_id, blob, received_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&mailbox_id)
    .bind(&msg_id_raw)
    .bind(body.as_ref())
    .bind(now)
    .bind(expires_at)
    .execute(&state.db)
    .await;

    match res {
        Ok(_) => Ok(Json(DepositResp {
            stored: true,
            msg_id: msg_id_b64,
            expires_at,
        })),
        Err(e) => {
            if format!("{e}").to_lowercase().contains("unique") {
                return Err(ApiError::Conflict);
            }
            Err(ApiError::ServerError)
        }
    }
}

#[derive(Deserialize)]
struct PollQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Serialize)]
struct PollMsg {
    msg_id: String,
    received_at: i64,
    expires_at: i64,
    blob_b64: String,
}

#[derive(Serialize)]
struct PollResp {
    cursor: String,
    messages: Vec<PollMsg>,
}

async fn poll(
    State(state): State<Arc<AppState>>,
    Path(mailbox_id): Path<String>,
    headers: HeaderMap,
    Query(q): Query<PollQuery>,
) -> Result<Json<PollResp>, ApiError> {
    // Auth poll token
    let token = bearer_token(&headers)?;
    let token_raw = b64url_decode(&token)?;
    if token_raw.len() != 32 {
        return Err(ApiError::Unauthorized);
    }
    let poll_hash = hmac_hash(&state.server_secret, &token_raw);

    let mb: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT poll_hash FROM mailboxes WHERE mailbox_id = ?")
            .bind(&mailbox_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| ApiError::ServerError)?;
    let Some((stored_hash,)) = mb else {
        return Err(ApiError::NotFound);
    };

    if stored_hash != poll_hash {
        return Err(ApiError::Forbidden);
    }

    let now = unix_ts();

    let last_id = match q.cursor.as_deref() {
        None => 0i64,
        Some(c) => cursor_decode(&state.server_secret, &mailbox_id, c)?,
    };

    let limit = q
        .limit
        .unwrap_or(state.poll_limit_default)
        .clamp(1, state.poll_limit_max);

    // ✅ Runtime query (avoid sqlx::query! compile-time DB access)
    let rows = sqlx::query(
        r#"
        SELECT id, msg_id, blob, received_at, expires_at
        FROM messages
        WHERE mailbox_id = ? AND id > ? AND expires_at > ?
        ORDER BY id ASC
        LIMIT ?
        "#,
    )
    .bind(&mailbox_id)
    .bind(last_id)
    .bind(now)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::ServerError)?;

    let mut msgs = Vec::with_capacity(rows.len());
    let mut new_last_id = last_id;

    for row in rows {
        let id: i64 = row.try_get("id").map_err(|_| ApiError::ServerError)?;
        let msg_id: Vec<u8> = row.try_get("msg_id").map_err(|_| ApiError::ServerError)?;
        let blob: Vec<u8> = row.try_get("blob").map_err(|_| ApiError::ServerError)?;
        let received_at: i64 = row.try_get("received_at").map_err(|_| ApiError::ServerError)?;
        let expires_at: i64 = row.try_get("expires_at").map_err(|_| ApiError::ServerError)?;

        new_last_id = id;
        msgs.push(PollMsg {
            msg_id: b64url_encode(&msg_id),
            received_at,
            expires_at,
            blob_b64: base64::engine::general_purpose::STANDARD.encode(blob),
        });
    }

    Ok(Json(PollResp {
        cursor: cursor_encode(&state.server_secret, &mailbox_id, new_last_id),
        messages: msgs,
    }))
}

#[derive(Deserialize)]
struct AckReq {
    msg_ids: Vec<String>,
}

#[derive(Serialize)]
struct AckResp {
    deleted: u64,
}

async fn ack(
    State(state): State<Arc<AppState>>,
    Path(mailbox_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<AckReq>,
) -> Result<Json<AckResp>, ApiError> {
    // Auth poll token
    let token = bearer_token(&headers)?;
    let token_raw = b64url_decode(&token)?;
    if token_raw.len() != 32 {
        return Err(ApiError::Unauthorized);
    }
    let poll_hash = hmac_hash(&state.server_secret, &token_raw);

    let mb: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT poll_hash FROM mailboxes WHERE mailbox_id = ?")
            .bind(&mailbox_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| ApiError::ServerError)?;
    let Some((stored_hash,)) = mb else {
        return Err(ApiError::NotFound);
    };

    if stored_hash != poll_hash {
        return Err(ApiError::Forbidden);
    }

    if req.msg_ids.is_empty() || req.msg_ids.len() > 2000 {
        return Err(ApiError::InvalidInput);
    }

    let mut deleted_total: u64 = 0;
    for msg_id in req.msg_ids {
        let raw = b64url_decode(&msg_id)?;
        let res = sqlx::query("DELETE FROM messages WHERE mailbox_id = ? AND msg_id = ?")
            .bind(&mailbox_id)
            .bind(raw)
            .execute(&state.db)
            .await
            .map_err(|_| ApiError::ServerError)?;
        deleted_total += res.rows_affected();
    }

    Ok(Json(AckResp { deleted: deleted_total }))
}

#[derive(Deserialize)]
struct RevokeReq {
    deposit_token_hashes: Vec<String>, // base64url(32 bytes)
}

#[derive(Serialize)]
struct RevokeResp {
    revoked: u64,
}

async fn revoke(
    State(state): State<Arc<AppState>>,
    Path(mailbox_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<RevokeReq>,
) -> Result<Json<RevokeResp>, ApiError> {
    // Auth poll token
    let token = bearer_token(&headers)?;
    let token_raw = b64url_decode(&token)?;
    if token_raw.len() != 32 {
        return Err(ApiError::Unauthorized);
    }
    let poll_hash = hmac_hash(&state.server_secret, &token_raw);

    let mb: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT poll_hash FROM mailboxes WHERE mailbox_id = ?")
            .bind(&mailbox_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| ApiError::ServerError)?;
    let Some((stored_hash,)) = mb else {
        return Err(ApiError::NotFound);
    };

    if stored_hash != poll_hash {
        return Err(ApiError::Forbidden);
    }

    if req.deposit_token_hashes.is_empty() || req.deposit_token_hashes.len() > 1000 {
        return Err(ApiError::InvalidInput);
    }

    let mut revoked_total: u64 = 0;
    for h in req.deposit_token_hashes {
        let raw = b64url_decode(&h)?;
        if raw.len() != 32 {
            return Err(ApiError::InvalidInput);
        }
        let res = sqlx::query(
            "UPDATE deposit_tokens SET revoked = 1 WHERE mailbox_id = ? AND dep_hash = ?",
        )
        .bind(&mailbox_id)
        .bind(raw)
        .execute(&state.db)
        .await
        .map_err(|_| ApiError::ServerError)?;
        revoked_total += res.rows_affected();
    }

    Ok(Json(RevokeResp {
        revoked: revoked_total,
    }))
}

