"""AgentCore Runtime entrypoint for the case-generation agent.

`generate` is acknowledged at once and runs as a tracked async task, so the
runtime session stays alive (HealthyBusy) until the case is published.
"""

from __future__ import annotations

import threading

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

from .llm import config, make_model

app = BedrockAgentCoreApp()


def _ping() -> dict:
    agent = Agent(model=make_model("checker"), callback_handler=None)
    reply = agent("Reply with the single word: ready")
    return {"ok": True, "model": config()["checkerModel"], "reply": str(reply).strip()}


def _generate_in_background(job_id: str) -> None:
    from . import lambda_handler

    task_id = app.add_async_task("generate", {"jobId": job_id})

    def work() -> None:
        try:
            lambda_handler.handler({"op": "generate", "jobId": job_id}, None)
        finally:
            app.complete_async_task(task_id)

    threading.Thread(target=work, daemon=True).start()


@app.entrypoint
def invoke(payload: dict) -> dict:
    op = payload.get("op")
    if op == "ping":
        return _ping()
    if op == "generate":
        _generate_in_background(payload["jobId"])
        return {"ok": True, "jobId": payload["jobId"], "accepted": True}
    return {"ok": False, "error": f"unknown op: {op}"}


if __name__ == "__main__":
    app.run()
