"""C1-T3 · 2026-07-05 · Export methods contract tests.

Direct handler invocations against a temp CLIPS_HOME so we cover the
five wrappers desktop-2/src/design-os/engine/sidecar-stub.ts calls:

  export_clip · cancel_export · save_copy_as · reveal_in_finder ·
  list_export_history

We DON'T ship a real ffmpeg run through the test suite (bundled
binary lives outside the repo · CI-only). Test scope:

  * METHODS map registers all five.
  * Param validation raises ValueError with clear messages.
  * cancel_export with no active job returns canceled=False.
  * save_copy_as / reveal_in_finder handle missing sources cleanly.
  * list_export_history round-trips through the persisted JSON file.

Run:  python3 desktop/python-sidecar/test_export_methods.py
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

# Ensure we import the sidecar module from its own dir · not
# a stale build artefact.
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

# Redirect CLIPS_HOME to a scratch dir before we import the sidecar so
# _movies_root / _export_history_path pick it up.
_TMP_HOME = Path(tempfile.mkdtemp(prefix="c1t3-clipshome-"))
os.environ["CLIPS_HOME"] = str(_TMP_HOME)

import sidecar as sc  # noqa: E402  (env var must be set before import)


def _teardown() -> None:
    shutil.rmtree(_TMP_HOME, ignore_errors=True)


def test_methods_map_registers_all_five() -> None:
    for name in (
        "export_clip",
        "cancel_export",
        "save_copy_as",
        "reveal_in_finder",
        "list_export_history",
    ):
        assert name in sc.METHODS, f"METHODS missing {name!r}"


def test_export_clip_rejects_missing_slug() -> None:
    try:
        sc.method_export_clip({"idx": 0})
    except ValueError as e:
        assert "slug" in str(e).lower()
    else:
        raise AssertionError("expected ValueError")


def test_export_clip_rejects_missing_idx() -> None:
    try:
        sc.method_export_clip({"slug": "x"})
    except ValueError as e:
        assert "idx" in str(e).lower()
    else:
        raise AssertionError("expected ValueError")


def test_export_clip_rejects_unknown_format() -> None:
    try:
        sc.method_export_clip({"slug": "x", "idx": 0, "format": "1.618:1"})
    except ValueError as e:
        assert "format" in str(e).lower()
    else:
        raise AssertionError("expected ValueError")


def test_cancel_export_with_no_active_returns_false() -> None:
    out = sc.method_cancel_export({})
    assert out == {"canceled": False}


def test_save_copy_as_requires_source() -> None:
    try:
        sc.method_save_copy_as({})
    except ValueError as e:
        assert "source" in str(e).lower()
    else:
        raise AssertionError("expected ValueError")


def test_save_copy_as_reports_missing_source() -> None:
    out = sc.method_save_copy_as({"source": str(_TMP_HOME / "nope.mp4")})
    assert out.get("dest") is None
    assert out.get("error") == "source_not_found"


def test_save_copy_as_copies_when_source_exists() -> None:
    src = _TMP_HOME / "clip.mp4"
    src.write_bytes(b"fake-mp4-bytes")
    out = sc.method_save_copy_as({"source": str(src)})
    dest = out.get("dest")
    assert isinstance(dest, str) and Path(dest).is_file()
    assert Path(dest).read_bytes() == b"fake-mp4-bytes"


def test_reveal_in_finder_requires_path() -> None:
    try:
        sc.method_reveal_in_finder({})
    except ValueError as e:
        assert "path" in str(e).lower()
    else:
        raise AssertionError("expected ValueError")


def test_reveal_in_finder_reports_missing_path() -> None:
    out = sc.method_reveal_in_finder({"path": str(_TMP_HOME / "nope.mp4")})
    assert out == {"revealed": False, "error": "path_not_found"}


def test_list_export_history_empty_when_no_file() -> None:
    # Ensure no history file exists.
    hpath = _TMP_HOME / "export_history.json"
    if hpath.exists():
        hpath.unlink()
    out = sc.method_list_export_history({})
    assert out == {"jobs": []}


def test_list_export_history_reads_persisted_rows() -> None:
    rows = [
        {"id": "ex-1", "clipIdx": 0, "status": "complete"},
        {"id": "ex-2", "clipIdx": 1, "status": "canceled"},
    ]
    sc._write_export_history(rows)
    out = sc.method_list_export_history({})
    assert out == {"jobs": rows}


def test_read_export_history_survives_corrupt_file() -> None:
    hpath = _TMP_HOME / "export_history.json"
    hpath.write_text("not valid json{{{", encoding="utf-8")
    out = sc.method_list_export_history({})
    assert out == {"jobs": []}


def test_read_export_history_ignores_non_list_root() -> None:
    hpath = _TMP_HOME / "export_history.json"
    hpath.write_text(json.dumps({"jobs": []}), encoding="utf-8")
    out = sc.method_list_export_history({})
    assert out == {"jobs": []}


def test_write_export_history_trims_to_200_rows() -> None:
    rows = [{"id": f"ex-{i}"} for i in range(250)]
    sc._write_export_history(rows)
    out = sc.method_list_export_history({})
    assert len(out["jobs"]) == 200


def _run_all() -> int:
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed: list[str] = []
    for fn in tests:
        try:
            fn()
            print(f"  ✓ {fn.__name__}")
        except AssertionError as e:  # noqa: PERF203
            failed.append(f"{fn.__name__}: {e}")
            print(f"  ✗ {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed.append(f"{fn.__name__}: {type(e).__name__}: {e}")
            print(f"  ✗ {fn.__name__}: {type(e).__name__}: {e}")
    return 0 if not failed else 1


if __name__ == "__main__":
    try:
        rc = _run_all()
    finally:
        _teardown()
    print(f"\n{len(globals())} tests run · rc={rc}")
    sys.exit(rc)
