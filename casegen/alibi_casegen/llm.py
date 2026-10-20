"""Model factory: every LLM call in the pipeline goes to Venice's OpenAI-compatible API."""

from __future__ import annotations

import json
import os
from functools import cache
from pathlib import Path
from typing import Literal

from strands.models.openai import OpenAIModel

Role = Literal["writer", "checker"]

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"

# A full case file runs to roughly 15k output tokens; leave room for a long one.
MAX_TOKENS: dict[str, int] = {"writer": 32_000, "checker": 8_000}


@cache
def config() -> dict:
    return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))


def get_venice_key() -> str:
    """Deployed, the key comes from AgentCore Identity; locally from the environment."""
    if os.environ.get("ALIBI_KEY_SOURCE") == "identity":
        from .identity import venice_key_from_identity

        return venice_key_from_identity()
    key = os.environ.get("VENICE_API_KEY")
    if not key:
        raise RuntimeError("VENICE_API_KEY is not set")
    return key


@cache
def _key() -> str:
    return get_venice_key()


def model_params(role: Role, key: str | None = None) -> dict:
    """Request parameters per call site. Extended thinking is off unless config names an effort for the call
    (it is slow: a plot spent two minutes thinking before writing a word)."""
    params: dict = {"temperature": 0.8 if role == "writer" else 0.0, "max_tokens": MAX_TOKENS[role]}
    effort = config().get("reasoningEffort", {}).get(key or "")
    if effort:
        params["reasoning_effort"] = effort
    else:
        params["extra_body"] = {"venice_parameters": {"disable_thinking": True}}
    return params


def make_model(role: Role, *, key: str | None = None, api_key: str | None = None) -> OpenAIModel:
    cfg = config()
    model_id = cfg["writerModel"] if role == "writer" else cfg["checkerModel"]
    return OpenAIModel(
        client_args={"api_key": api_key or get_venice_key(), "base_url": cfg["veniceBaseUrl"], "timeout": 900},
        model_id=model_id,
        params=model_params(role, key),
    )


def venice_llm(role: str, key: str) -> OpenAIModel:
    """Pipeline model factory; `key` names the call site (stage), which picks its reasoning effort."""
    return make_model("writer" if role == "writer" else "checker", key=key, api_key=_key())
