# Alembic (staged)

Alembic is not yet the active migration engine on `junior-backend` —
the FastAPI lifespan runs `Base.metadata.create_all(bind=engine)` +
per-column idempotent `ALTER TABLE` blocks. New tables landed via
`create_all` on the next deploy.

This directory stages migration files so that when alembic IS adopted,
the schema history is already documented one-file-per-change with the
right upgrade / downgrade DDL. Every new file here MUST:

  1. Match the ORM model change that landed in `app/models.py`.
  2. Use `revises = "<previous file's revision>"` when a predecessor
     exists.
  3. Be re-runnable — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF
     NOT EXISTS`, etc.

## Files

- `versions/20260710_01_state_overrides.py` — Lane B · Chapter 5 ·
  State Puppeteer table.
