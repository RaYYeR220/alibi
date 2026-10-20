"""Stage 5: random and hostile play against the real engine; one leak fails the job."""

from __future__ import annotations

from ..pipeline import Draft, JobFailed, PipelineDeps


def run(draft: Draft, deps: PipelineDeps) -> None:
    case = draft.case or {}
    lint = deps.canon.lint(case)
    if lint:
        raise JobFailed("redteam", "lint: " + "; ".join(f"{i['code']}: {i['detail']}" for i in lint[:5]))
    report = deps.canon.redteam(case, runs=deps.redteam_runs)
    draft.redteam = report
    if report.get("violationCount", 0):
        first = report["violations"][0]
        raise JobFailed(
            "redteam",
            f"{report['violationCount']} spoiler-guard violations in {report['runs']} runs "
            f"(first: {first['kind']} leaked {', '.join(first['leakedFactIds'])})",
        )
