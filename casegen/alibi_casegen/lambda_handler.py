"""Lambda entrypoint. Step Functions runs one pipeline stage per invocation:

    {"op": "stage", "stage": "<name>", "jobId": "..."}   run a stage on the draft in S3
    {"op": "fail", "jobId": "...", "error": {...}}       record a failure caught by the state machine
    {"op": "generate", "jobId": "..."}                   whole pipeline in one invocation
    {"op": "ping"}                                       model round trip

Environment: ALIBI_TABLE, ALIBI_BUCKET, ALIBI_ASSET_BASE_URL (optional),
ALIBI_ART / ALIBI_VOICES ("0" skips the stage), ALIBI_REDTEAM_RUNS.
"""

from __future__ import annotations

import json
import os

from .llm import config, get_venice_key, venice_llm
from .pipeline import Draft, JobInput, PipelineDeps, generate, record_failure, run_stage


def _table():
    import boto3

    return boto3.resource("dynamodb").Table(os.environ["ALIBI_TABLE"])


def _jobs():
    from .progress import DynamoJobs

    return DynamoJobs(_table())


def _storage():
    import boto3

    from .storage import AwsStorage

    return AwsStorage(
        bucket=os.environ["ALIBI_BUCKET"],
        table=_table(),
        s3=boto3.client("s3"),
        asset_base_url=os.environ.get("ALIBI_ASSET_BASE_URL"),
    )


def _llm():
    return venice_llm


def _images():
    if os.environ.get("ALIBI_ART") == "0":
        return None
    from .stages.art import VeniceImages

    return VeniceImages(api_key=get_venice_key(), model=config()["imageModel"], base_url=config()["veniceBaseUrl"])


def _tts():
    if os.environ.get("ALIBI_VOICES") == "0":
        return None
    import boto3

    from .stages.voices import PollyTts

    return PollyTts(boto3.client("polly"))


def _deps(jobs, stage: str | None = None) -> PipelineDeps:
    """Clients for the stage at hand (all of them when stage is None)."""
    return PipelineDeps(
        llm=_llm(),
        progress=jobs,
        storage=_storage(),
        images=_images() if stage in (None, "art") else None,
        tts=_tts() if stage in (None, "voices") else None,
        redteam_runs=int(os.environ.get("ALIBI_REDTEAM_RUNS", "500")),
    )


def _job_input(jobs, job_id: str) -> JobInput:
    record = jobs.get(job_id)
    if record is None:
        raise ValueError(f"no job {job_id}")
    return JobInput.from_job(record)


def _stage(name: str, job_id: str) -> dict:
    jobs = _jobs()
    deps = _deps(jobs, name)
    if name == "moderate":
        draft = Draft(job=_job_input(jobs, job_id))
    else:
        draft = Draft.model_validate_json(deps.storage.load_draft(job_id))
    run_stage(name, draft, deps)
    deps.storage.save_draft(job_id, draft.model_dump_json())
    out: dict = {"jobId": job_id, "stage": name}
    if name == "prove":
        out.update(proven=draft.proven, attempts=draft.attempts)
    return out


def _fail(job_id: str, error: dict | None) -> dict:
    """Called from the state machine's Catch with {"Error", "Cause"}."""
    jobs = _jobs()
    message = (error or {}).get("Error") or "error"
    cause = (error or {}).get("Cause")
    if cause:
        try:
            message = json.loads(cause).get("errorMessage") or message
        except (TypeError, json.JSONDecodeError):
            message = str(cause)
    record = jobs.get(job_id) or {}
    job = JobInput.from_job(record) if record.get("householdId") else None
    stage = record.get("stage", "unknown")
    if job:
        record_failure(_deps(jobs, "fail"), job, stage, message)
    else:
        jobs.failed(job_id, stage, message)
    return {"jobId": job_id, "failed": True}


def _ping() -> dict:
    from strands import Agent

    from .llm import make_model

    agent = Agent(model=make_model("checker"), callback_handler=None)
    reply = agent("Reply with the single word: ready")
    return {"ok": True, "model": config()["checkerModel"], "reply": str(reply).strip()}


def handler(event: dict, context: object) -> dict:
    op = event.get("op")
    if op == "ping":
        return _ping()
    if op == "stage":
        return _stage(event["stage"], event["jobId"])
    if op == "fail":
        return _fail(event["jobId"], event.get("error"))
    if op == "generate":
        jobs = _jobs()
        result = generate(_job_input(jobs, event["jobId"]), _deps(jobs))
        return {"jobId": event["jobId"], "caseId": result.case["meta"]["id"], "attempts": result.attempts}
    return {"ok": False, "error": f"unknown op: {op}"}
