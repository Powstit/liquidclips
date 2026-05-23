# Junior Backend — agent guide

FastAPI on Railway. Auth + tier resolution + license JWT issuance for the desktop app + account-app. Source of truth for the user model is `app/models.py`; the broader architecture lives in `~/Desktop/jnr/oauth-billing.md`.

## Run locally

```bash
.venv/bin/uvicorn app.main:app --reload --port 8000
```

First boot generates an Ed25519 keypair in `.junior-keys/`. Don't commit it. Production uses `JWT_PRIVATE_PEM` / `JWT_PUBLIC_PEM` env vars.

## Test the endpoints

```bash
# health
curl http://localhost:8000/healthcheck

# public key the desktop bundles for offline verification
curl http://localhost:8000/desktop/public-key

# fake a Clerk-style user creation (without svix verification — works in dev mode)
curl -X POST http://localhost:8000/webhooks/clerk -H "content-type: application/json" -d '{
  "type": "user.created",
  "data": {
    "id": "user_test_abc",
    "primary_email_address_id": "idn_1",
    "email_addresses": [{"id": "idn_1", "email_address": "test@example.com"}],
    "unsafe_metadata": {"affiliate_id": "aff_test123"}
  }
}'

# mint a license for that user
curl -X POST http://localhost:8000/desktop/connect -H "content-type: application/json" -d '{
  "clerk_user_id": "user_test_abc",
  "challenge": "ch_xxx"
}'

# call /sync with the JWT
JWT="<paste the license_jwt from above>"
curl http://localhost:8000/sync -H "authorization: Bearer $JWT"
```

## Architecture rules

- **Don't mirror Whop's full subscription record.** We cache `whop_user_id`, `paid_until`, `subscription_status`. Whop is the source of truth.
- **NEVER overwrite `users.affiliate_id`** — first-touch locked at signup per `oauth-billing.md` §6.
- **Webhooks are idempotent.** `WebhookEvent.external_id` is unique; check it before processing.
- **License JWTs are Ed25519, 30-day expiry, auto-rotated by `/sync` when ≤5 days remaining.** Bundle the public key in the desktop binary; don't fetch it at runtime.
- **No async DB.** Sync SQLAlchemy 2.x with FastAPI's threadpool. Don't migrate to async without a real perf reason.

## Deploy to Railway

When the user has provisioned the Railway project + a Postgres add-on:

1. Connect this repo to the Railway service.
2. Set env vars per `.env.example` — in particular generate JWT_PRIVATE_PEM / JWT_PUBLIC_PEM once and paste in.
3. Railway's start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
4. Healthcheck path: `/healthcheck`.
5. After first deploy, run `alembic upgrade head` (once we have the first migration). Until then `Base.metadata.create_all` in the lifespan creates tables.
