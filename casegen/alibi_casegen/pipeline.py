"""Personalized case generation.

    moderate -> plot -> (compile -> prove) x up to 3 -> anchors -> redteam -> art -> voices -> publish

`generate` runs every stage in one process (local runs, tests). On AWS each
stage is a Step Functions task that calls `run_stage` on a draft kept in S3,
and the compile/prove loop is a Choice state.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from .canon import CanonCli
from .progress import ProgressSink, now_ms
from .replay import LlmFactory
from .storage import Storage

MAX_COMPILES = 3


class JobFailed(Exception):
    """A deliberate stop: the job is marked failed and the household is told."""

    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage
        self.draft: Draft | None = None


class JobInput(BaseModel):
    job_id: str
    household_id: str
    names: list[str] = Field(min_length=1, max_length=5)
    occasion: str | None = None
    setting: str | None = None
    tone: Literal["cozy", "classic", "noir"] = "cozy"
    rating: Literal["family", "teen", "mature"] = "family"
    # Authoring extras (local briefs only; the MCP tool never sends these).
    notes: str | None = None
    case_id: str | None = None
    price_cents: int = 0
    suspects: int | None = None

    @classmethod
    def from_job(cls, job: dict) -> JobInput:
        given = job.get("input") or {}
        return cls(
            job_id=job["jobId"],
            household_id=job["householdId"],
            names=given.get("names") or [],
            occasion=given.get("occasion"),
            setting=given.get("setting"),
            tone=given.get("tone") or "cozy",
            rating=given.get("rating") or "family",
        )


class Draft(BaseModel):
    """Everything one job knows so far; serialized between Step Functions stages."""

    job: JobInput
    moderation: str | None = None
    plot: dict | None = None
    case: dict | None = None
    attempts: int = 0
    proven: bool = False
    issues: list[dict] = []
    voices: dict[str, str] = {}
    narrator_voice: str | None = None
    anchor_report: dict | None = None
    redteam: dict | None = None
    assets: dict[str, str] = {}
    timings: dict[str, float] = {}
    notes: list[str] = []


class ImageClient(Protocol):
    def generate(self, prompt: str, *, width: int = 1024, height: int = 1024) -> bytes: ...


class TtsClient(Protocol):
    def synthesize(self, text: str, voice_id: str) -> bytes: ...


@dataclass
class PipelineDeps:
    llm: LlmFactory
    progress: ProgressSink
    storage: Storage
    images: ImageClient | None = None
    tts: TtsClient | None = None
    canon: CanonCli = field(default_factory=CanonCli)
    redteam_runs: int = 500
    clock: Callable[[], int] = now_ms


@dataclass
class GeneratedCase:
    case: dict
    attempts: int
    anchor_report: dict
    redteam: dict
    timings: dict[str, float]
    voices: dict[str, str]
    narrator_voice: str | None
    plot: dict
    notes: list[str]

    @classmethod
    def from_draft(cls, d: Draft) -> GeneratedCase:
        return cls(
            case=d.case or {},
            attempts=d.attempts,
            anchor_report=d.anchor_report or {},
            redteam=d.redteam or {},
            timings=dict(d.timings),
            voices=dict(d.voices),
            narrator_voice=d.narrator_voice,
            plot=d.plot or {},
            notes=list(d.notes),
        )


def _stages() -> dict[str, tuple[Callable[[Draft, PipelineDeps], Any], int]]:
    from .stages import anchors, art, compile, moderate, plot, prove, publish, redteam, voices

    return {
        "moderate": (moderate.run, 5),
        "plot": (plot.run, 15),
        "compile": (compile.run, 35),
        "prove": (prove.run, 50),
        "anchors": (anchors.run, 65),
        "redteam": (redteam.run, 75),
        "art": (art.run, 85),
        "voices": (voices.run, 93),
        "publish": (publish.run, 100),
    }


STAGE_ORDER = ["moderate", "plot", "compile", "prove", "anchors", "redteam", "art", "voices", "publish"]


def run_stage(name: str, draft: Draft, deps: PipelineDeps) -> Draft:
    fn, percent = _stages()[name]
    deps.progress.update(draft.job.job_id, name, percent)
    started = time.perf_counter()
    try:
        fn(draft, deps)
    finally:
        draft.timings[name] = round(draft.timings.get(name, 0.0) + time.perf_counter() - started, 2)
    return draft


def record_failure(deps: PipelineDeps, job: JobInput, stage: str, message: str) -> None:
    """Marks the job failed and tells the household. The custom-case credit comes back unless the
    case was already delivered or the details themselves were refused at moderation."""
    if deps.progress.is_done(job.job_id):
        return
    refund = stage != "moderate"
    if refund:
        deps.storage.refund_credit(job.household_id, job.job_id)
    deps.progress.failed(job.job_id, stage, message)
    deps.storage.add_inbox(
        job.household_id,
        {
            "id": f"job-{job.job_id}",
            "kind": "custom_failed",
            "text": (
                "Your custom case could not be finished, so your credit is back. Try asking again."
                if refund
                else "Your custom case could not be written with those details. Try different names or a different occasion."
            ),
            "at": deps.clock(),
        },
    )


def generate(job: JobInput, deps: PipelineDeps) -> GeneratedCase:
    draft = Draft(job=job)
    stage = "moderate"
    try:
        for stage in ("moderate", "plot"):
            run_stage(stage, draft, deps)
        while True:
            for stage in ("compile", "prove"):
                run_stage(stage, draft, deps)
            if draft.proven:
                break
        for stage in ("anchors", "redteam", "art", "voices", "publish"):
            run_stage(stage, draft, deps)
    except JobFailed as err:
        err.draft = draft
        record_failure(deps, job, err.stage, str(err))
        raise
    except Exception as err:
        record_failure(deps, job, stage, f"{type(err).__name__}: {err}")
        raise
    return GeneratedCase.from_draft(draft)
