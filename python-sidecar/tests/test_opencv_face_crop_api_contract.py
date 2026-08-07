"""2026-07-29 · caught live: requirements.txt pinned `opencv-python>=4.10`
with no upper bound, so pip resolved to 5.0.0 — a major release that
removed `cv2.CascadeClassifier` (the Haar-cascade face detector
stages.py's smart-crop/reframe uses for the Cut stage) in favor of a
DNN-based `cv2.FaceDetectorYN`. Every Cut-stage run failed with
"AttributeError: module 'cv2' has no attribute 'CascadeClassifier'",
and nothing caught it because this API surface had zero test coverage.

This test has no direct assertions about stages.py's own logic — it
just pins the exact cv2 API contract that code depends on, so a future
opencv-python bump that drops/renames it fails CI immediately instead
of silently breaking every user's Cut stage in production.
"""
from __future__ import annotations

import cv2


def test_cascade_classifier_exists():
    assert hasattr(cv2, "CascadeClassifier"), (
        "cv2.CascadeClassifier is gone — stages.py's face-crop reframing "
        "(the Cut stage) uses this directly. Check requirements.txt's "
        "opencv-python upper bound before letting this regress."
    )


def test_haarcascades_data_path_and_default_frontalface_file_load():
    assert hasattr(cv2, "data") and hasattr(cv2.data, "haarcascades")
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(cascade_path)
    assert not cascade.empty(), (
        f"CascadeClassifier failed to load {cascade_path} — the bundled "
        "Haar cascade XML data may be missing from this opencv-python build."
    )
