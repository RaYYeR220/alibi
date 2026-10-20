"""The TypeScript canon CLI, called as a subprocess (lint and red team)."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from .paths import CANON_CLI


class CanonError(RuntimeError):
    pass


class CanonCli:
    def __init__(self, cli: str | None = None, node: str | None = None) -> None:
        self.cli = cli or os.environ.get("ALIBI_CANON_CLI") or str(CANON_CLI)
        self.node = node or os.environ.get("ALIBI_NODE", "node")

    def _run(self, case: dict, *args: str) -> tuple[int, str, str]:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "case.json"
            path.write_text(json.dumps(case), encoding="utf-8")
            proc = subprocess.run(
                [self.node, self.cli, args[0], str(path), *args[1:]],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=600,
            )
        return proc.returncode, proc.stdout, proc.stderr

    def lint(self, case: dict) -> list[dict]:
        """Schema, cross-reference and fingerprint issues; empty when the case is clean."""
        code, out, err = self._run(case, "lint", "--json")
        try:
            return json.loads(out)["issues"]
        except (json.JSONDecodeError, KeyError) as exc:
            raise CanonError(f"lint failed (exit {code}): {err.strip()[:500]}") from exc

    def redteam(self, case: dict, runs: int, seed: int | None = None) -> dict:
        args = ["redteam", "--runs", str(runs), "--json"]
        if seed is not None:
            args += ["--seed", str(seed)]
        code, out, err = self._run(case, *args)
        try:
            return json.loads(out)
        except json.JSONDecodeError as exc:
            raise CanonError(f"redteam failed (exit {code}): {err.strip()[:500]}") from exc
