"""Replay and recording models for the pipeline's LLM calls.

Every LLM call in the pipeline asks the factory for a model with a role and a
call key (the stage name, or "anchors-check" and the like). ReplayLlm answers
from text files named ``<key>.<n>.txt`` so tests run offline against real
Strands agents; RecordingLlm wraps a live factory and writes those files.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import AsyncIterable, Callable
from pathlib import Path
from typing import Any

from strands.models.model import Model

LlmFactory = Callable[[str, str], Model]


def _last_user_text(messages: list[dict]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            return "".join(block.get("text", "") for block in message.get("content", []))
    return ""


def _text_events(text: str):
    yield {"messageStart": {"role": "assistant"}}
    yield {"contentBlockStart": {"start": {}}}
    yield {"contentBlockDelta": {"delta": {"text": text}}}
    yield {"contentBlockStop": {}}
    yield {"messageStop": {"stopReason": "end_turn"}}
    yield {"metadata": {"usage": {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}, "metrics": {"latencyMs": 0}}}


class _ReplayModel(Model):
    def __init__(self, owner: ReplayLlm, key: str):
        self.owner = owner
        self.key = key

    def update_config(self, **model_config: Any) -> None:
        pass

    def get_config(self) -> dict:
        return {"model_id": f"replay:{self.key}"}

    async def structured_output(self, output_model, prompt, system_prompt=None, **kwargs):  # pragma: no cover
        raise NotImplementedError("the pipeline parses JSON from text replies")
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs) -> AsyncIterable[dict]:
        text = self.owner.next(self.key, _last_user_text(messages))
        for event in _text_events(text):
            yield event


class ReplayLlm:
    """Serves recorded replies; the first directory holding ``<key>.<n>.txt`` wins."""

    def __init__(self, dirs: list[Path], overrides: dict[str, list[str]] | None = None):
        self.dirs = [Path(d) for d in dirs]
        self.overrides = overrides or {}
        self._count: Counter[str] = Counter()
        self._prompts: dict[str, list[str]] = defaultdict(list)
        self._calls: list[str] = []

    def __call__(self, role: str, key: str) -> Model:
        return _ReplayModel(self, key)

    def next(self, key: str, prompt: str) -> str:
        self._count[key] += 1
        n = self._count[key]
        self._calls.append(key)
        self._prompts[key].append(prompt)
        if key in self.overrides:
            return self.overrides[key][n - 1]
        for d in self.dirs:
            path = d / f"{key}.{n}.txt"
            if path.exists():
                return path.read_text(encoding="utf-8")
        raise FileNotFoundError(f"no recorded reply {key}.{n}.txt in {', '.join(map(str, self.dirs))}")

    def prompts(self, key: str) -> list[str]:
        return list(self._prompts[key])

    def calls(self) -> list[str]:
        return list(self._calls)


class _RecordingModel(Model):
    def __init__(self, inner: Model, owner: RecordingLlm, key: str):
        self.inner = inner
        self.owner = owner
        self.key = key

    def update_config(self, **model_config: Any) -> None:
        self.inner.update_config(**model_config)

    def get_config(self) -> Any:
        return self.inner.get_config()

    def structured_output(self, output_model, prompt, system_prompt=None, **kwargs):  # pragma: no cover
        return self.inner.structured_output(output_model, prompt, system_prompt=system_prompt, **kwargs)

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs) -> AsyncIterable[dict]:
        parts: list[str] = []
        async for event in self.inner.stream(messages, tool_specs, system_prompt, **kwargs):
            delta = event.get("contentBlockDelta", {}).get("delta", {})
            if "text" in delta:
                parts.append(delta["text"])
            yield event
        self.owner.save(self.key, "".join(parts))


class RecordingLlm:
    """Wraps a live model factory and keeps every reply as ``<key>.<n>.txt``."""

    def __init__(self, inner: LlmFactory, out_dir: Path):
        self.inner = inner
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self._count: Counter[str] = Counter()

    def __call__(self, role: str, key: str) -> Model:
        return _RecordingModel(self.inner(role, key), self, key)

    def save(self, key: str, text: str) -> None:
        self._count[key] += 1
        (self.out_dir / f"{key}.{self._count[key]}.txt").write_text(text, encoding="utf-8")
