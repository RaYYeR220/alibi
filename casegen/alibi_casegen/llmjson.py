"""Asking an agent for JSON and getting usable JSON back."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any, TypeVar

from pydantic import ValidationError
from strands import Agent

from .replay import LlmFactory

T = TypeVar("T")

_FENCE = re.compile(r"```(?:json)?\s*\n(.*?)\n```", re.DOTALL)


def extract_json(text: str) -> Any:
    """The first JSON object in a reply, fenced or bare."""
    for block in _FENCE.findall(text):
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            continue
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            value, _ = decoder.raw_decode(text, match.start())
            return value
        except json.JSONDecodeError:
            continue
    raise ValueError("reply holds no JSON object")


class LlmOutputError(RuntimeError):
    pass


def _brief(err: Exception) -> str:
    if isinstance(err, ValidationError):
        return "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in err.errors()[:8])
    return str(err)[:500]


def ask_json(
    llm: LlmFactory,
    role: str,
    key: str,
    system: str,
    prompt: str,
    validate: Callable[[Any], T] | None = None,
    retries: int = 1,
) -> T:
    """Runs one agent turn and parses its JSON reply, asking again once if it is unusable."""
    agent = Agent(model=llm(role, key), system_prompt=system, callback_handler=None)
    reply = str(agent(prompt))
    for attempt in range(retries + 1):
        try:
            data = extract_json(reply)
            return validate(data) if validate else data
        except (ValueError, ValidationError) as err:
            if attempt == retries:
                raise LlmOutputError(f"{key}: unusable reply ({_brief(err)})") from err
            reply = str(agent(f"That reply could not be used: {_brief(err)}. Reply again with only the corrected JSON."))
    raise AssertionError("unreachable")
