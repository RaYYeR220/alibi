"""AgentCore Runtime entrypoint for the case-generation agent."""

from __future__ import annotations

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

from .llm import config, make_model

app = BedrockAgentCoreApp()


def _ping() -> dict:
    agent = Agent(model=make_model("checker"), callback_handler=None)
    reply = agent("Reply with the single word: ready")
    return {"ok": True, "model": config()["checkerModel"], "reply": str(reply).strip()}


@app.entrypoint
def invoke(payload: dict) -> dict:
    op = payload.get("op")
    if op == "ping":
        return _ping()
    return {"ok": False, "error": f"unknown op: {op}"}


if __name__ == "__main__":
    app.run()
