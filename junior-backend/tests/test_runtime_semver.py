"""Regression coverage for ``app.runtime_semver.cmp_version``.

The runtime-manifest deployment-order clamp (see
``app/routes/runtime.py`` :: `manifest` :: "Deployment-order safety
clamp") uses this comparator to decide whether the manifest may
advertise ``minimum_supported_version``. The invariant is:

    minimum_supported_version <= currently_served_version

If the comparator ever disagrees with the frontend twin (in
``desktop-2/src/lib/mandatoryUpdate.ts``) about the ordering of two
runtime versions, the mandatory Kade gate can be triggered against a
bundle that isn't actually available for download — which is the
exact bug class this module exists to eliminate.

These cases are LOCK-STEP with the frontend
``mandatoryUpdate.test.ts`` cases · any drift indicates one side has
been changed and the other has not.
"""
from __future__ import annotations

import pytest

from app.runtime_semver import cmp_version


# ── Numeric ordering ──────────────────────────────────────────────────
def test_lower_major_is_less():
    assert cmp_version("1.0.0", "2.0.0") == -1


def test_higher_major_is_greater():
    assert cmp_version("2.0.0", "1.0.0") == 1


def test_equal_all_numeric_is_zero():
    assert cmp_version("2.2.36", "2.2.36") == 0


def test_lower_minor_is_less():
    assert cmp_version("2.1.99", "2.2.0") == -1


def test_lower_patch_is_less():
    assert cmp_version("2.2.36", "2.2.37") == -1


def test_much_higher_patch_dominates():
    assert cmp_version("2.2.999", "2.3.0") == -1


# ── Tag-vs-no-tag (SemVer 2.0.0: no tag > tag) ───────────────────────
def test_no_tag_beats_any_tag_release():
    assert cmp_version("2.2.36", "2.2.36-anything") == 1


def test_tag_loses_to_no_tag_release():
    assert cmp_version("2.2.36-anything", "2.2.36") == -1


def test_higher_numeric_beats_tagged_lower():
    assert cmp_version("2.2.37", "2.2.37-stage1") == 1


def test_higher_numeric_beats_tagged_higher_release():
    # Numeric core dominates before tag comparison.
    assert cmp_version("2.2.38", "2.2.37-stage1") == 1


def test_lower_numeric_loses_regardless_of_tag():
    assert cmp_version("2.2.36-zeta", "2.2.37-alpha") == -1


# ── Tag-vs-tag (lexical within numeric core equality) ────────────────
def test_lexical_tag_order_string_segments():
    assert cmp_version("2.2.36-a", "2.2.36-b") == -1


def test_lexical_tag_order_reverse():
    assert cmp_version("2.2.36-b", "2.2.36-a") == 1


def test_equal_tags_are_equal():
    assert cmp_version("2.2.36-stage1", "2.2.36-stage1") == 0


def test_dot_segmented_tag_numeric_compared_as_numbers():
    # `10` > `9` numerically, even though "10" < "9" lexically.
    assert cmp_version("2.2.36-rc.10", "2.2.36-rc.9") == 1


def test_dot_segmented_tag_shorter_ranks_lower_when_prefix():
    # SemVer 2.0.0 · shorter tag with matching prefix ranks lower.
    assert cmp_version("2.2.36-rc", "2.2.36-rc.1") == -1


def test_numeric_segment_ranks_below_string_segment():
    # SemVer 2.0.0 · at a given tag segment, numeric < string.
    assert cmp_version("2.2.36-1", "2.2.36-alpha") == -1


def test_control_tower_below_release():
    # This is the specific pair the Stage 1 rollout exercises.
    assert cmp_version("2.2.36-control-tower-1", "2.2.36") == -1


def test_stage1_below_release():
    assert cmp_version("2.2.37-stage1", "2.2.37") == -1


def test_stage1_below_next_release_regardless_of_tag():
    # 2.2.37-stage1 must sort BELOW 2.2.38 · numeric MAJOR.MINOR.PATCH
    # dominates before tag comparison.
    assert cmp_version("2.2.37-stage1", "2.2.38") == -1


# ── +build metadata is ignored (SemVer 2.0.0 explicit requirement) ───
def test_build_metadata_ignored_equal():
    assert cmp_version("2.2.36+ci-42", "2.2.36+ci-99") == 0


def test_build_metadata_ignored_across_lesser_version():
    assert cmp_version("2.2.35+ci-99", "2.2.36+ci-1") == -1


def test_build_metadata_on_tagged_version_still_ignored():
    assert cmp_version("2.2.37-stage1+build.a", "2.2.37-stage1+build.b") == 0


# ── Fail-safe: unparseable input returns None (caller must degrade) ──
def test_empty_string_returns_none():
    assert cmp_version("", "2.2.36") is None
    assert cmp_version("2.2.36", "") is None


def test_missing_patch_component_returns_none():
    assert cmp_version("2.2", "2.2.0") is None


def test_extra_numeric_component_returns_none():
    # Runtime bundle emitter always writes MAJOR.MINOR.PATCH · anything
    # else is corrupt input and must NOT be silently coerced.
    assert cmp_version("2.2.36.1", "2.2.36") is None


def test_non_numeric_core_returns_none():
    assert cmp_version("v2.2.36", "2.2.36") is None
    assert cmp_version("2.a.36", "2.2.36") is None


def test_none_input_returns_none():
    assert cmp_version(None, "2.2.36") is None  # type: ignore[arg-type]
    assert cmp_version("2.2.36", None) is None  # type: ignore[arg-type]


def test_whitespace_trimmed_before_parse():
    assert cmp_version("  2.2.36  ", "2.2.36") == 0


# ── The exact case the clamp exists to defend against ───────────────
def test_clamp_case_env_above_served_returns_greater():
    # env=2.2.38, served=2.2.37-stage1 · env-min > served → clamp drops.
    # This test asserts the ordering the clamp relies on.
    assert cmp_version("2.2.38", "2.2.37-stage1") == 1


def test_clamp_case_env_equals_served_returns_zero():
    # env=2.2.38, served=2.2.38 · env-min == served → clamp includes.
    assert cmp_version("2.2.38", "2.2.38") == 0


def test_clamp_case_env_below_served_returns_less():
    # env=2.2.37-stage1, served=2.2.38 · env-min < served → clamp includes.
    assert cmp_version("2.2.37-stage1", "2.2.38") == -1
