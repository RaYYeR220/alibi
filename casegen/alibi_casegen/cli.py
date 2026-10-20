"""Command-line entry points."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .prover import prove


def validate_main(argv: list[str] | None = None) -> int:
    """alibi-validate <case.json>...: exits 0 when every case is provably fair."""
    files = sys.argv[1:] if argv is None else argv
    if not files:
        print("usage: alibi-validate <case.json>...")
        return 2
    failed = 0
    for name in files:
        report = prove(json.loads(Path(name).read_text(encoding="utf-8")))
        if report.ok:
            print(f"{name}: ok (culprit {report.unique_culprit})")
            continue
        failed += 1
        print(f"{name}: {len(report.issues)} issue(s)")
        for issue in report.issues:
            print(f"  {issue.code}: {issue.detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(validate_main())
