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


def make_model(role: Role) -> OpenAIModel:
    cfg = config()
    model_id = cfg["writerModel"] if role == "writer" else cfg["checkerModel"]
    return OpenAIModel(
        client_args={"api_key": get_venice_key(), "base_url": cfg["veniceBaseUrl"]},
        model_id=model_id,
        params={"temperature": 0.8 if role == "writer" else 0.0},
    )
