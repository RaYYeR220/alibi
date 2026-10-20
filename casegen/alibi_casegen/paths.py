"""Repo-relative resources; in the Lambda image ALIBI_REPO_ROOT points at the copied subset."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(os.environ.get("ALIBI_REPO_ROOT") or Path(__file__).resolve().parents[2])
CANON_CLI = REPO_ROOT / "packages" / "canon" / "dist" / "cli.js"
EXAMPLE_CASE = REPO_ROOT / "packages" / "canon" / "test" / "fixtures" / "tiny-case.json"
