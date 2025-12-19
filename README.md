# whisper-mailbox (Rust) — WHISPER Mailbox v0.1 Reference Server

Reference implementation of the WHISPER mailbox server (store-and-forward relay).
It stores **opaque encrypted blobs** and uses **capability tokens** to prevent spam.

## Quickstart

```bash
cp .env.example .env
# edit SERVER_SECRET with a strong random string (32+ bytes)
export $(cat .env | xargs)

cargo run
