"""Art and voice clips for a finished, hand-curated case.

Runs the same house style and voice casting as the generation pipeline, keeps a
local cache so nothing is paid for twice, and uploads to the assets bucket
under assets/cases/<caseId>/ (served by the API at /assets/*).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

from .stages.art import HOUSE_STYLE, subjects
from .stages.voices import FEMALE, MALE, NARRATOR_VOICE
from .storage import asset_key


class Images(Protocol):
    def generate(self, prompt: str, *, width: int = 1024, height: int = 1024) -> bytes: ...


class Tts(Protocol):
    def synthesize(self, text: str, voice_id: str) -> bytes: ...


class Uploader(Protocol):
    def upload(self, key: str, data: bytes, content_type: str) -> None: ...


class S3Uploader:
    def __init__(self, bucket: str, client) -> None:
        self.bucket = bucket
        self.client = client

    def upload(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type, CacheControl="public, max-age=86400")


def _cached(cache: Path, name: str, make) -> bytes:
    path = cache / name
    if path.exists():
        return path.read_bytes()
    data = make()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def produce_media(case: dict, *, images: Images | None, tts: Tts | None, uploader: Uploader, cache_dir: Path) -> dict:
    cid = case["meta"]["id"]
    cache = Path(cache_dir)
    case["victim"].setdefault("portrait", f"{case['victim']['id']}.png")

    if images is not None:
        for name, subject, (w, h) in subjects(case, None):
            data = _cached(cache, name, lambda s=subject, w=w, h=h: images.generate(f"{HOUSE_STYLE} {s}", width=w, height=h))
            uploader.upload(asset_key(cid, name), data, "image/png")

    taken: set[str] = set()
    for s in case["suspects"]:
        if s.get("voiceId") not in set(FEMALE) | set(MALE) or s["voiceId"] in taken:
            s["voiceId"] = next(v for v in FEMALE + MALE if v not in taken)
        taken.add(s["voiceId"])
    voices = {s["id"]: s["voiceId"] for s in case["suspects"]}

    if tts is not None:
        for a in case["anchors"]:
            name = f"audio/{a['id']}.mp3"
            voice = voices.get(a["speakerId"], NARRATOR_VOICE)
            data = _cached(cache, f"{name}.{voice}", lambda t=a["text"], v=voice: tts.synthesize(t, v))
            uploader.upload(asset_key(cid, name), data, "audio/mpeg")
            a["audioUrl"] = name
    return case


def media_main(argv: list[str] | None = None) -> int:
    """alibi-media <case.json>... --bucket NAME [--no-art] [--no-voices]"""
    import argparse
    import os

    import boto3

    from .llm import config
    from .stages.art import VeniceImages
    from .stages.voices import PollyTts

    p = argparse.ArgumentParser(description="Render art and voice clips for curated cases and upload them.")
    p.add_argument("cases", nargs="+")
    p.add_argument("--bucket", required=True)
    p.add_argument("--no-art", action="store_true")
    p.add_argument("--no-voices", action="store_true")
    args = p.parse_args(argv)

    session = boto3.Session()
    uploader = S3Uploader(args.bucket, session.client("s3"))
    images = None if args.no_art else VeniceImages(api_key=os.environ["VENICE_API_KEY"], model=config()["imageModel"])
    tts = None if args.no_voices else PollyTts(session.client("polly", region_name="us-east-1"))
    for path in map(Path, args.cases):
        case = json.loads(path.read_text(encoding="utf-8"))
        produce_media(case, images=images, tts=tts, uploader=uploader, cache_dir=path.parent / "assets")
        path.write_text(json.dumps(case, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{path}: media ready")
    return 0
