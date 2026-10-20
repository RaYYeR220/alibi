"""Lambda entrypoint: the case-generation pipeline runs as Step Functions tasks on Lambda."""

from __future__ import annotations

from strands import Agent

from .llm import config, make_model


def _ping() -> dict:
    agent = Agent(model=make_model("checker"), callback_handler=None)
    reply = agent("Reply with the single word: ready")
    return {"ok": True, "model": config()["checkerModel"], "reply": str(reply).strip()}


def handler(event: dict, context: object) -> dict:
    op = event.get("op")
    if op == "ping":
        return _ping()
    return {"ok": False, "error": f"unknown op: {op}"}
