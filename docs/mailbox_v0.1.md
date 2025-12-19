# WHISPER Mailbox v0.1 — Technical Spec

This document defines the WHISPER Mailbox v0.1 API and security model.

## Goals
- Offline delivery with minimal infrastructure
- Server cannot read message content
- No global directory
- Anti-spam by capability tokens
- Multi-mailbox support (F3NIX + community nodes)

## Security Model
Mailbox servers are **dumb relays**:
- store opaque encrypted blobs
- indexed by mailbox_id + message_id
- no ENS, no identities, no routing graph

Server operators (including community nodes) must not be able to:
- spam all users
- enumerate users
- infer who talks to whom

### Capability tokens
- `poll_token`: read capability (owner-only)
- `deposit_token`: write capability (shared per contact)

Tokens are 32-byte random values encoded as base64url.

Server stores only HMAC(server_secret, token) hashes.

## Data Model
- `mailboxes(mailbox_id, poll_hash)`
- `deposit_tokens(mailbox_id, dep_hash, revoked)`
- `messages(mailbox_id, msg_id, blob, received_at, expires_at)`

## Endpoints

### POST /v1/mailboxes
Create a mailbox. Client may provide its own poll_token or let server generate one.

### POST /v1/mailboxes/{mailbox_id}/deposit-tokens
Register deposit tokens for a mailbox (owner-only). Idempotent. Server stores only hashed tokens.

### POST /v1/mailboxes/{mailbox_id}/deposit
Deposit an encrypted blob into recipient mailbox (requires `deposit_token`).

Headers:
- `Authorization: Bearer <deposit_token>`
- `X-Whisper-MsgId: base64url(16..32 bytes)`
- `X-Whisper-ExpiresAt: unix ts` (optional)

Body:
- `application/octet-stream` (cipher blob)

### GET /v1/mailboxes/{mailbox_id}/poll
Poll messages (requires `poll_token`).
- cursor is opaque and signed by server
- limit clamped to max

### POST /v1/mailboxes/{mailbox_id}/ack
Acknowledge / delete messages by msg_id (requires `poll_token`).

### POST /v1/mailboxes/{mailbox_id}/revoke
Revoke deposit tokens by providing their hashed values (requires `poll_token`).

## TTL / Limits
- Default TTL: 7 days
- Max TTL: 14 days
- Max message size: 16KB (configurable)
- Max queue size: 10MB (configurable)
- Rate limits: per token and per IP (implementation-specific)

## Deduplication
- Server: `UNIQUE(mailbox_id, msg_id)` enables idempotent deposits (`409` on duplicate)
- Client: keep local `seen_msg_ids` set (dedupe across multiple mailboxes)

## Multi-mailbox client behavior
- Each user maintains 2–5 mailboxes.
- Sender deposits to primary; fallback or parallel deposit to secondary nodes.
- Receiver polls all configured mailboxes and dedupes by msg_id.

## Non-goals
- global presence / discovery
- message routing logic
- on-chain operations
- federation replication between mailboxes

## Implementation notes (Rust reference)
The reference server:
- uses SQLite + WAL
- uses HMAC-SHA256 to hash tokens
- uses a signed opaque cursor to paginate messages
- runs TTL purge in a background task
