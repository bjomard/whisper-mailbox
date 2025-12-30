curl -sS "$NGROK_BASE/v1/mailboxes/$MAILBOX_ID/poll"   -H "Authorization: Bearer $POLL_TOKEN" | jq -r '.messages[-1].blob_b64' | python3 -c 'import sys,base64; b=sys.stdin.read().strip();
import sys as _s
if (not b) or b=="null": _s.exit(2)
pad="="*((4-len(b)%4)%4); raw=base64.urlsafe_b64decode(b+pad);
sys.stdout.write(raw.decode("utf-8"))' | node dist/decrypt_envelope.js -

