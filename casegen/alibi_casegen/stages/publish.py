"""Stage 8: hand the finished case to the household."""

from __future__ import annotations

from ..pipeline import Draft, PipelineDeps


def run(draft: Draft, deps: PipelineDeps) -> None:
    case = draft.case or {}
    job = draft.job
    case_id = case["meta"]["id"]
    deps.storage.save_case(case)
    deps.storage.save_custom_case(job.household_id, case)
    deps.storage.add_inbox(
        job.household_id,
        {
            "id": f"job-{job.job_id}",
            "kind": "custom_ready",
            "text": f"Your custom case \"{case['meta']['title']}\" is ready. Say \"start {case['meta']['title']}\" to play.",
            "at": deps.clock(),
            "caseId": case_id,
        },
    )
    deps.progress.done(job.job_id, case_id)
