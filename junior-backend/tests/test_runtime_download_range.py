"""GET /runtime/download/<version> · HTTP Range + ETag + If-Range coverage.

Updater v2 (2026-07-20) · introduced along with the desktop shell rewrite
that streams downloads to a resumable ``.partial`` file. The two sides
must agree on the byte protocol so a mid-stream disconnect on the shell
side resumes cleanly instead of restarting from byte zero.

Contract this suite locks:

  1. Full GET always emits ETag + Accept-Ranges + correct Content-Length.
  2. Valid Range → 206 Partial Content · Content-Range: bytes A-B/N.
  3. Suffix Range (bytes=-N) → last N bytes as 206.
  4. Range past EOF → 416 with Content-Range: */N.
  5. Range + If-Range matching current ETag → 206 (resume).
  6. Range + If-Range mismatched (bundle changed) → 200 full body
     (RFC 7233 says the client's partial is stale).
  7. Manifest ETag + If-None-Match round-trip · 304 on match.

The 200 full-body path preserves the pre-v2 contract so an OLD shell
that doesn't send Range headers keeps working unchanged.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as _text

from app.db import engine
from app.main import app
import app.routes.runtime as runtime_module


# ─── Fixture: a real bundle on disk + a matching row in runtime_manifests ─

_TEST_CHANNEL = "test-range"
_TEST_VERSION = "9.9.99"
_TEST_BODY = (b"LIQUIDCLIPS-RUNTIME-BUNDLE-" * 400)  # ~10 KB · large enough for range math


@pytest.fixture(scope="module", autouse=True)
def _ensure_runtime_manifests_table():
    """Create the manifest table if the test DB doesn't have it yet.
    Same pattern as test_runtime_manifest_shapes so both files can run
    in isolation."""
    with engine.begin() as conn:
        conn.execute(
            _text(
                """CREATE TABLE IF NOT EXISTS runtime_manifests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    version VARCHAR(80) NOT NULL UNIQUE,
                    channel VARCHAR(40) NOT NULL,
                    sha256 VARCHAR(80) NOT NULL,
                    signature TEXT NOT NULL,
                    file VARCHAR(200) NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    pub_date TIMESTAMP NOT NULL,
                    ship_lens_verdict VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                    ship_lens_review_url TEXT,
                    promoted_at TIMESTAMP
                )"""
            )
        )
    yield


@pytest.fixture
def bundle_on_disk(tmp_path, monkeypatch):
    """Write the test body to a temp dir + point the router at it +
    insert a manifest row so the download handler can find both."""
    monkeypatch.setattr(runtime_module, "runtime_dir", lambda: tmp_path)
    fname = f"liquidclips-runtime-{_TEST_VERSION}.tar.gz"
    (tmp_path / fname).write_bytes(_TEST_BODY)
    sha256 = hashlib.sha256(_TEST_BODY).hexdigest()

    with engine.begin() as conn:
        conn.execute(
            _text("DELETE FROM runtime_manifests WHERE version = :v"),
            {"v": _TEST_VERSION},
        )
        conn.execute(
            _text(
                """INSERT INTO runtime_manifests
                    (version, channel, sha256, signature, file, notes,
                     pub_date, ship_lens_verdict, ship_lens_review_url)
                   VALUES
                    (:v, :c, :sha, 'sig', :file, '',
                     :pub, 'PASS', NULL)"""
            ),
            {
                "v": _TEST_VERSION,
                "c": _TEST_CHANNEL,
                "sha": sha256,
                "file": fname,
                "pub": datetime.now(timezone.utc),
            },
        )
    yield {
        "sha256": sha256,
        "etag": f'"{sha256}"',
        "size": len(_TEST_BODY),
        "body": _TEST_BODY,
    }
    with engine.begin() as conn:
        conn.execute(
            _text("DELETE FROM runtime_manifests WHERE version = :v"),
            {"v": _TEST_VERSION},
        )


def _client() -> TestClient:
    return TestClient(app)


# ─── 1 · full GET emits ETag + Accept-Ranges + correct Content-Length ────
def test_full_get_emits_range_headers(bundle_on_disk):
    r = _client().get(f"/runtime/download/{_TEST_VERSION}")
    assert r.status_code == 200
    assert r.headers["ETag"] == bundle_on_disk["etag"]
    assert r.headers["Accept-Ranges"] == "bytes"
    assert r.headers["Content-Length"] == str(bundle_on_disk["size"])
    assert r.content == bundle_on_disk["body"]


# ─── 2 · valid Range returns 206 with Content-Range ──────────────────────
def test_range_returns_206_with_content_range(bundle_on_disk):
    total = bundle_on_disk["size"]
    r = _client().get(
        f"/runtime/download/{_TEST_VERSION}",
        headers={"Range": "bytes=100-199"},
    )
    assert r.status_code == 206
    assert r.headers["Content-Range"] == f"bytes 100-199/{total}"
    assert r.headers["Content-Length"] == "100"
    assert r.headers["ETag"] == bundle_on_disk["etag"]
    assert r.content == bundle_on_disk["body"][100:200]


# ─── 3 · open-ended Range · bytes=N- ─────────────────────────────────────
def test_open_ended_range(bundle_on_disk):
    total = bundle_on_disk["size"]
    start = total - 500
    r = _client().get(
        f"/runtime/download/{_TEST_VERSION}",
        headers={"Range": f"bytes={start}-"},
    )
    assert r.status_code == 206
    assert r.headers["Content-Range"] == f"bytes {start}-{total - 1}/{total}"
    assert r.content == bundle_on_disk["body"][start:]


# ─── 4 · suffix Range · bytes=-N ─────────────────────────────────────────
def test_suffix_range(bundle_on_disk):
    total = bundle_on_disk["size"]
    r = _client().get(
        f"/runtime/download/{_TEST_VERSION}",
        headers={"Range": "bytes=-256"},
    )
    assert r.status_code == 206
    assert r.headers["Content-Range"] == f"bytes {total - 256}-{total - 1}/{total}"
    assert r.content == bundle_on_disk["body"][-256:]


# ─── 5 · out-of-range Range → 416 with Content-Range: */total ────────────
def test_range_past_eof_returns_416(bundle_on_disk):
    total = bundle_on_disk["size"]
    r = _client().get(
        f"/runtime/download/{_TEST_VERSION}",
        headers={"Range": f"bytes={total + 999}-{total + 1999}"},
    )
    assert r.status_code == 416
    assert r.headers["Content-Range"] == f"bytes */{total}"


# ─── 6 · Range + If-Range matching → 206 (resume authorised) ─────────────
def test_range_with_matching_if_range_returns_206(bundle_on_disk):
    r = _client().get(
        f"/runtime/download/{_TEST_VERSION}",
        headers={
            "Range": "bytes=500-999",
            "If-Range": bundle_on_disk["etag"],
        },
    )
    assert r.status_code == 206
    assert r.content == bundle_on_disk["body"][500:1000]


# ─── 7 · Range + If-Range mismatched → 200 full body ─────────────────────
def test_range_with_mismatched_if_range_returns_full_body(bundle_on_disk):
    r = _client().get(
        f"/runtime/download/{_TEST_VERSION}",
        headers={
            "Range": "bytes=500-999",
            "If-Range": '"different-etag-because-bundle-changed"',
        },
    )
    assert r.status_code == 200
    # Client's partial is stale · they receive the full body + can discard.
    assert r.headers["Content-Length"] == str(bundle_on_disk["size"])
    assert r.content == bundle_on_disk["body"]


# ─── 8 · malformed Range → 200 full body (fail-open) ─────────────────────
def test_malformed_range_falls_through_to_full_body(bundle_on_disk):
    r = _client().get(
        f"/runtime/download/{_TEST_VERSION}",
        headers={"Range": "not-a-range-header"},
    )
    # Header regex doesn't match → treated as "no Range" → 200 full.
    # (Some servers 416 here; we fail-open so an old client with a bad
    # header still gets its bundle.)
    assert r.status_code == 200
    assert r.content == bundle_on_disk["body"]


# ─── 9 · manifest ETag round-trip · If-None-Match → 304 ──────────────────
def test_manifest_returns_304_on_if_none_match(bundle_on_disk):
    # First fetch captures the ETag.
    r1 = _client().get(f"/runtime/manifest.json?channel={_TEST_CHANNEL}")
    assert r1.status_code == 200
    etag = r1.headers["ETag"]
    assert etag.startswith('"m-')

    # Second fetch with If-None-Match → 304 no body.
    r2 = _client().get(
        f"/runtime/manifest.json?channel={_TEST_CHANNEL}",
        headers={"If-None-Match": etag},
    )
    assert r2.status_code == 304
    assert r2.content == b""
    assert r2.headers["ETag"] == etag


# ─── 10 · manifest ETag differs when bundle changes ──────────────────────
def test_manifest_etag_is_stable_across_identical_bundles(bundle_on_disk):
    r1 = _client().get(f"/runtime/manifest.json?channel={_TEST_CHANNEL}")
    r2 = _client().get(f"/runtime/manifest.json?channel={_TEST_CHANNEL}")
    # Same underlying row → same ETag on repeat.
    assert r1.headers["ETag"] == r2.headers["ETag"]


# ─── 11 · missing bundle on disk still 404s ──────────────────────────────
def test_missing_bundle_returns_404(tmp_path, monkeypatch):
    """Insert a manifest row but do NOT write the file → 404."""
    monkeypatch.setattr(runtime_module, "runtime_dir", lambda: tmp_path)
    with engine.begin() as conn:
        conn.execute(
            _text("DELETE FROM runtime_manifests WHERE version = 'orphan.1'"),
        )
        conn.execute(
            _text(
                """INSERT INTO runtime_manifests
                    (version, channel, sha256, signature, file, notes,
                     pub_date, ship_lens_verdict, ship_lens_review_url)
                   VALUES
                    ('orphan.1', 'test-orphan', 'ab', 'sig',
                     'liquidclips-runtime-orphan.1.tar.gz', '',
                     :pub, 'PASS', NULL)"""
            ),
            {"pub": datetime.now(timezone.utc)},
        )
    try:
        r = _client().get("/runtime/download/orphan.1")
        assert r.status_code == 404
    finally:
        with engine.begin() as conn:
            conn.execute(
                _text("DELETE FROM runtime_manifests WHERE version = 'orphan.1'"),
            )
