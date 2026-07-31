# 2026-07-31 · Render standby deploy. Railway builds this service via
# Nixpacks auto-detection (see railway.json) and has no Dockerfile of its
# own — Render's "Liquidclips" service is configured for Docker, so this
# mirrors Railway's actual build/start behavior (same requirements.txt,
# same start command, same healthcheck path) rather than introducing a
# third, divergent way to run this app.
FROM python:3.12-slim

WORKDIR /app

# psycopg2-binary ships prebuilt wheels — no libpq-dev needed at build time.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Render sets $PORT at runtime, same contract as Railway's startCommand
# in railway.json.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
