import json
from pathlib import Path

import pytest

from alibi_casegen.pipeline import record_failure, JobFailed, JobInput, PipelineDeps, generate
from alibi_casegen.progress import MemoryProgress
from alibi_casegen.prover import prove
from alibi_casegen.replay import ReplayLlm
from alibi_casegen.storage import LocalStorage

RECORDED = Path(__file__).parent / "fixtures" / "recorded"


class FakeImages:
    def __init__(self):
        self.prompts: list[str] = []

    def generate(self, prompt: str, *, width: int = 1024, height: int = 1024) -> bytes:
        self.prompts.append(prompt)
        return b"\x89PNG fake"


class FakeTts:
    def __init__(self):
        self.calls: list[tuple[str, str]] = []

    def synthesize(self, text: str, voice_id: str) -> bytes:
        self.calls.append((text, voice_id))
        return b"ID3 fake"


def make_deps(tmp_path: Path, scenario: str, **overrides) -> PipelineDeps:
    deps = PipelineDeps(
        llm=ReplayLlm([RECORDED / scenario, RECORDED / "base"]),
        progress=MemoryProgress(),
        storage=LocalStorage(tmp_path / "out"),
        images=FakeImages(),
        tts=FakeTts(),
        redteam_runs=40,
    )
    for k, v in overrides.items():
        setattr(deps, k, v)
    return deps


JOB = JobInput(
    job_id="job-0001",
    household_id="hh-demo",
    names=["Margaret", "Harold", "Clara", "Perkins"],
    occasion="Aunt Margaret's seventieth birthday",
    tone="cozy",
    rating="family",
)


def test_pipeline_happy_path_produces_valid_case(tmp_path):
    deps = make_deps(tmp_path, "base")
    result = generate(JOB, deps)
    case = result.case

    report = prove(case)
    assert report.ok, report.issues
    assert report.unique_culprit == "clara"
    assert case["meta"]["id"].startswith("custom-")
    assert case["meta"]["priceCents"] == 0
    assert all(a.get("audioUrl") for a in case["anchors"])
    # relative to the case folder, the way the server builds asset URLs
    assert all(a["audioUrl"] == f"audio/{a['id']}.mp3" for a in case["anchors"])
    assert {v for _, v in deps.tts.calls} <= set(result.voices.values()) | {result.narrator_voice}
    assert all(s["portrait"] for s in case["suspects"])
    assert len(deps.images.prompts) == len(case["suspects"]) + len(case["evidence"]) + 2  # + victim and cover
    assert all("ink and gouache" in p for p in deps.images.prompts)

    assert deps.progress.jobs["job-0001"]["status"] == "done"
    assert deps.progress.jobs["job-0001"]["caseId"] == case["meta"]["id"]
    stages = [e["stage"] for e in deps.progress.events]
    assert stages[:4] == ["moderate", "plot", "compile", "prove"]
    assert stages[-1] == "publish"
    saved = deps.storage.custom_case("hh-demo", case["meta"]["id"])
    assert saved["meta"]["title"] == "The Brooch at Ashby House"
    assert deps.storage.inbox("hh-demo")[-1]["kind"] == "custom_ready"
    assert result.redteam["violationCount"] == 0
    assert set(result.timings) >= {"moderate", "plot", "compile", "prove", "anchors", "redteam", "art", "voices", "publish"}


def test_prove_failure_feeds_back_and_recovers(tmp_path):
    deps = make_deps(tmp_path, "prove-retry")
    result = generate(JOB, deps)

    assert result.attempts == 2
    second_prompt = deps.llm.prompts("compile")[1]
    assert "not_unique" in second_prompt
    assert prove(result.case).ok


def test_compile_gives_up_after_three_attempts(tmp_path):
    broken = (RECORDED / "prove-retry" / "compile.1.txt").read_text(encoding="utf-8")
    llm = ReplayLlm([RECORDED / "base"], overrides={"compile": [broken, broken, broken]})
    deps = make_deps(tmp_path, "base", llm=llm)
    with pytest.raises(JobFailed) as err:
        generate(JOB, deps)
    assert err.value.stage == "prove"
    assert "not_unique" in str(err.value)
    assert deps.progress.jobs["job-0001"]["status"] == "failed"
    assert deps.storage.inbox("hh-demo")[-1]["kind"] == "custom_failed"
    # the household gets its custom-case credit back, once
    assert deps.storage.refunds("hh-demo") == ["job-0001"]
    record_failure(deps, JOB, "moderate", "again")
    assert deps.storage.refunds("hh-demo") == ["job-0001"]


def test_anchor_with_unsupported_claim_is_dropped(tmp_path):
    deps = make_deps(tmp_path, "bad-anchor")
    result = generate(JOB, deps)

    crack = next(a for a in result.case["anchors"] if a["id"] == "a_harold_crack")
    assert "red coat" not in crack["text"]
    assert "fetch garden twine" in crack["text"]  # falls back to the canon truth the crack reveals
    assert result.anchor_report["dropped"] == ["a_harold_crack"]
    assert result.anchor_report["rewritten"] == ["a_harold_crack"]
    assert prove(result.case).ok


def test_moderation_reject_marks_job_failed(tmp_path):
    deps = make_deps(tmp_path, "moderation-reject")
    with pytest.raises(JobFailed) as err:
        generate(JOB, deps)

    assert err.value.stage == "moderate"
    job = deps.progress.jobs["job-0001"]
    assert job["status"] == "failed"
    assert job["error"].startswith("moderation:")
    assert deps.llm.calls() == ["moderate"]  # nothing else ran
    assert deps.storage.inbox("hh-demo")[-1]["kind"] == "custom_failed"
    # a refusal the household caused does not give the credit back
    assert deps.storage.refunds("hh-demo") == []


def test_art_and_voices_can_be_skipped(tmp_path):
    deps = make_deps(tmp_path, "base", images=None, tts=None)
    result = generate(JOB, deps)
    assert not any(a.get("audioUrl") for a in result.case["anchors"])
    assert result.case["suspects"][0]["voiceId"] in result.voices.values()
    assert prove(result.case).ok


def test_live_recording_replays_to_a_proven_case(tmp_path):
    """Every reply from a real run (the Okafor family, Grandma Ada's 80th) played back through the pipeline."""
    okafor = JobInput(
        job_id="okafor-final",
        household_id="hh-okafor",
        names=["the Okafor family"],
        occasion="Grandma Ada's 80th birthday",
        tone="cozy",
        rating="family",
    )
    deps = make_deps(tmp_path, "okafor-live")
    deps.llm = ReplayLlm([RECORDED / "okafor-live"])
    result = generate(okafor, deps)

    report = prove(result.case)
    assert report.ok, report.issues
    assert result.case["meta"]["rating"] == "family"
    assert result.redteam["violationCount"] == 0
    assert all(a.get("audioUrl") for a in result.case["anchors"])
    assert deps.progress.jobs["okafor-final"]["status"] == "done"


def test_job_input_from_server_record():
    job = {
        "jobId": "j1",
        "householdId": "hh",
        "status": "queued",
        "stage": "queued",
        "percent": 0,
        "input": {"names": ["Ada", "Tunde"], "occasion": "Grandma Ada's 80th birthday", "tone": "cozy", "rating": "family"},
    }
    ji = JobInput.from_job(job)
    assert ji.job_id == "j1" and ji.household_id == "hh"
    assert ji.names == ["Ada", "Tunde"] and ji.tone == "cozy" and ji.rating == "family"


def test_draft_round_trips_as_json(tmp_path):
    from alibi_casegen.pipeline import Draft

    d = Draft(job=JOB)
    d.plot = {"title": "x"}
    again = Draft.model_validate_json(d.model_dump_json())
    assert again.plot == {"title": "x"} and again.job.names == JOB.names
    assert json.loads(d.model_dump_json())["job"]["job_id"] == "job-0001"


def test_a_failure_after_publishing_does_not_refund(tmp_path):
    deps = make_deps(tmp_path, "base", images=None, tts=None)
    generate(JOB, deps)
    assert deps.progress.jobs["job-0001"]["status"] == "done"
    record_failure(deps, JOB, "publish", "late error")
    assert deps.storage.refunds("hh-demo") == []
