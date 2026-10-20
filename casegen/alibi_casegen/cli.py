"""Command-line entry points.

    alibi-validate <case.json>...                       prove every case fair
    alibi-generate --brief <brief.yaml> --out <dir>     run the pipeline locally
"""

from __future__ import annotations

import argparse
import json
import sys
import time
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


def _brief(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if path.suffix in (".yaml", ".yml"):
        import yaml

        return yaml.safe_load(text)
    return json.loads(text)


class _StubImages:
    def generate(self, prompt: str, *, width: int = 1024, height: int = 1024) -> bytes:
        return b"placeholder image"


class _StubTts:
    def synthesize(self, text: str, voice_id: str) -> bytes:
        return b"placeholder audio"


def generate_main(argv: list[str] | None = None) -> int:
    from .llm import config, get_venice_key, venice_llm
    from .pipeline import JobFailed, JobInput, PipelineDeps, generate
    from .progress import PrintProgress
    from .replay import RecordingLlm
    from .storage import LocalStorage

    p = argparse.ArgumentParser(prog="alibi-generate", description="Generate a case locally.")
    p.add_argument("--brief", type=Path, required=True, help="YAML or JSON: names, occasion, setting, tone, rating, notes, caseId, priceCents, suspects")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--no-art", action="store_true")
    p.add_argument("--no-voices", action="store_true")
    p.add_argument("--stub-media", action="store_true", help="run the art and voice stages with placeholder bytes")
    p.add_argument("--record", type=Path, help="keep every LLM reply here as <key>.<n>.txt")
    p.add_argument("--runs", type=int, default=500, help="red-team runs")
    args = p.parse_args(argv)

    b = _brief(args.brief)
    job = JobInput(
        job_id=b.get("jobId") or f"local-{int(time.time())}",
        household_id=b.get("householdId") or "local",
        names=b["names"],
        occasion=b.get("occasion"),
        setting=b.get("setting"),
        tone=b.get("tone", "cozy"),
        rating=b.get("rating", "family"),
        notes=b.get("notes"),
        case_id=b.get("caseId"),
        price_cents=b.get("priceCents", 0),
        suspects=b.get("suspects"),
    )
    llm = RecordingLlm(venice_llm, args.record) if args.record else venice_llm
    images = tts = None
    if args.stub_media:
        images, tts = _StubImages(), _StubTts()
    elif not args.no_art:
        from .stages.art import VeniceImages

        images = VeniceImages(api_key=get_venice_key(), model=config()["imageModel"], base_url=config()["veniceBaseUrl"])
    if not args.no_voices and not args.stub_media:
        import boto3

        from .stages.voices import PollyTts

        tts = PollyTts(boto3.client("polly"))
    deps = PipelineDeps(llm=llm, progress=PrintProgress(), storage=LocalStorage(args.out / "store"), images=images, tts=tts, redteam_runs=args.runs)

    args.out.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    try:
        result = generate(job, deps)
    except JobFailed as err:
        if err.draft is not None:
            (args.out / "draft.json").write_text(err.draft.model_dump_json(indent=1), encoding="utf-8")
        print(f"failed at {err.stage}: {err}")
        return 1
    total = round(time.perf_counter() - started, 1)
    (args.out / "case.json").write_text(json.dumps(result.case, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    proof = prove(result.case)
    summary = {
        "caseId": result.case["meta"]["id"],
        "title": result.case["meta"]["title"],
        "seconds": total,
        "timings": result.timings,
        "attempts": result.attempts,
        "prove": {"ok": proof.ok, "culprit": proof.unique_culprit, "issues": [i.code for i in proof.issues]},
        "redteam": {k: result.redteam.get(k) for k in ("runs", "steps", "violationCount")},
        "anchors": result.anchor_report,
        "notes": result.notes,
    }
    (args.out / "report.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["generate"]:
        return generate_main(argv[1:])
    return validate_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
