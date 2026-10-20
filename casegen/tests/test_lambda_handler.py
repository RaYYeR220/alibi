import json

from alibi_casegen import lambda_handler
from alibi_casegen.pipeline import Draft, JobInput
from alibi_casegen.progress import JobCancelled, MemoryProgress
from alibi_casegen.replay import ReplayLlm
from alibi_casegen.storage import LocalStorage
from tests.test_pipeline import RECORDED, FakeImages, FakeTts


class Jobs(MemoryProgress):
    def __init__(self, record: dict):
        super().__init__()
        self.record = record

    def get(self, job_id: str) -> dict | None:
        return self.record if job_id == self.record["jobId"] else None


def wire(monkeypatch, tmp_path, scenario="base"):
    jobs = Jobs(
        {
            "jobId": "j-77",
            "householdId": "hh-okafor",
            "status": "queued",
            "stage": "queued",
            "percent": 0,
            "input": {"names": ["Ada", "Tunde"], "occasion": "Grandma Ada's 80th birthday", "tone": "cozy", "rating": "family"},
        }
    )
    storage = LocalStorage(tmp_path)
    llm = ReplayLlm([RECORDED / scenario, RECORDED / "base"])
    monkeypatch.setattr(lambda_handler, "_jobs", lambda: jobs)
    monkeypatch.setattr(lambda_handler, "_storage", lambda: storage)
    monkeypatch.setattr(lambda_handler, "_llm", lambda: llm)
    monkeypatch.setattr(lambda_handler, "_images", lambda: FakeImages())
    monkeypatch.setattr(lambda_handler, "_tts", lambda: FakeTts())
    monkeypatch.setenv("ALIBI_REDTEAM_RUNS", "30")
    return jobs, storage


def test_each_stage_reads_and_writes_the_draft(monkeypatch, tmp_path):
    jobs, storage = wire(monkeypatch, tmp_path)

    out = lambda_handler.handler({"op": "stage", "stage": "moderate", "jobId": "j-77"}, None)
    assert out == {"jobId": "j-77", "stage": "moderate"}
    draft = Draft.model_validate_json(storage.load_draft("j-77"))
    assert draft.job.household_id == "hh-okafor" and draft.job.names == ["Ada", "Tunde"]

    for stage in ("plot", "compile"):
        lambda_handler.handler({"op": "stage", "stage": stage, "jobId": "j-77"}, None)
    proved = lambda_handler.handler({"op": "stage", "stage": "prove", "jobId": "j-77"}, None)
    assert proved == {"jobId": "j-77", "stage": "prove", "proven": True, "attempts": 1}
    for stage in ("anchors", "redteam", "art", "voices", "publish"):
        lambda_handler.handler({"op": "stage", "stage": stage, "jobId": "j-77"}, None)

    assert jobs.jobs["j-77"]["status"] == "done"
    case_id = jobs.jobs["j-77"]["caseId"]
    assert storage.custom_case("hh-okafor", case_id)["meta"]["id"] == case_id


def test_prove_reports_not_proven_so_the_state_machine_loops(monkeypatch, tmp_path):
    jobs, storage = wire(monkeypatch, tmp_path, "prove-retry")
    for stage in ("moderate", "plot", "compile"):
        lambda_handler.handler({"op": "stage", "stage": stage, "jobId": "j-77"}, None)
    first = lambda_handler.handler({"op": "stage", "stage": "prove", "jobId": "j-77"}, None)
    assert first["proven"] is False and first["attempts"] == 1
    lambda_handler.handler({"op": "stage", "stage": "compile", "jobId": "j-77"}, None)
    second = lambda_handler.handler({"op": "stage", "stage": "prove", "jobId": "j-77"}, None)
    assert second["proven"] is True and second["attempts"] == 2


def test_fail_op_records_the_error_from_a_step_functions_catch(monkeypatch, tmp_path):
    jobs, storage = wire(monkeypatch, tmp_path)
    lambda_handler.handler({"op": "stage", "stage": "moderate", "jobId": "j-77"}, None)
    cause = json.dumps({"errorMessage": "moderation: not suitable", "errorType": "JobFailed"})
    out = lambda_handler.handler({"op": "fail", "jobId": "j-77", "error": {"Error": "JobFailed", "Cause": cause}}, None)
    assert out == {"jobId": "j-77", "failed": True}
    assert jobs.jobs["j-77"]["status"] == "failed"
    assert jobs.jobs["j-77"]["error"] == "moderation: not suitable"
    assert storage.inbox("hh-okafor")[-1]["kind"] == "custom_failed"


def test_unknown_op_is_reported():
    assert lambda_handler.handler({"op": "nope"}, None) == {"ok": False, "error": "unknown op: nope"}


def test_job_input_is_built_from_the_job_record(monkeypatch, tmp_path):
    jobs, storage = wire(monkeypatch, tmp_path)
    lambda_handler.handler({"op": "stage", "stage": "moderate", "jobId": "j-77"}, None)
    draft = Draft.model_validate_json(storage.load_draft("j-77"))
    assert isinstance(draft.job, JobInput)
    assert draft.job.occasion == "Grandma Ada's 80th birthday"


def test_a_job_cancelled_before_it_started_is_not_written(monkeypatch, tmp_path):
    jobs, storage = wire(monkeypatch, tmp_path)
    jobs.failed("j-77", "dispatch", "could not start")
    try:
        lambda_handler.handler({"op": "stage", "stage": "moderate", "jobId": "j-77"}, None)
    except JobCancelled:
        pass
    else:
        raise AssertionError("a cancelled job ran its first stage")
    assert jobs.events == []


def test_fail_op_leaves_an_already_failed_job_alone(monkeypatch, tmp_path):
    jobs, storage = wire(monkeypatch, tmp_path)
    jobs.failed("j-77", "dispatch", "could not start")
    jobs.record.update(status="failed", stage="dispatch")
    lambda_handler.handler({"op": "fail", "jobId": "j-77", "error": {"Error": "JobCancelled"}}, None)
    assert storage.inbox("hh-okafor") == []
    assert storage.refunds("hh-okafor") == []
    assert jobs.jobs["j-77"]["error"] == "could not start"
