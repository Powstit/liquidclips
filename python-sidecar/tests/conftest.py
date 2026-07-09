"""Test bootstrap · adds python-sidecar/ to sys.path so tests can import
the sidecar modules without an install step."""
import os
import sys

_HERE = os.path.dirname(__file__)
_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
