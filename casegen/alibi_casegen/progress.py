"""Job progress as the MCP server reads it: the JOB#<id>/JOB item's `job` map."""

from __future__ import annotations

import json
import time
from decimal import Decimal
from typing import Any, Protocol


def now_ms() -> int:
    return int(time.time() * 1000)


class ProgressSink(Protocol):
    def update(self, job_id: str, stage: str, percent: int) -> None: ...
    def done(self, job_id: str, case_id: str) -> None: ...
    def failed(self, job_id: str, stage: str, error: str) -> None: ...
    def is_done(self, job_id: str) -> bool: ...


class MemoryProgress:
    """Keeps job records and the stage log in memory (tests, local runs)."""

    def __init__(self) -> None:
        self.jobs: dict[str, dict] = {}
        self.events: list[dict] = []

    def _job(self, job_id: str) -> dict:
        return self.jobs.setdefault(job_id, {"jobId": job_id})

    def update(self, job_id: str, stage: str, percent: int) -> None:
        self.events.append({"jobId": job_id, "stage": stage, "percent": percent})
        self._job(job_id).update(status="running", stage=stage, percent=percent)

    def done(self, job_id: str, case_id: str) -> None:
        self._job(job_id).update(status="done", stage="done", percent=100, caseId=case_id)

    def failed(self, job_id: str, stage: str, error: str) -> None:
        self._job(job_id).update(status="failed", stage=stage, error=error)

    def is_done(self, job_id: str) -> bool:
        return self.jobs.get(job_id, {}).get("status") == "done"


class PrintProgress(MemoryProgress):
    def update(self, job_id: str, stage: str, percent: int) -> None:
        super().update(job_id, stage, percent)
        print(f"[{percent:3d}%] {stage}", flush=True)

    def failed(self, job_id: str, stage: str, error: str) -> None:
        super().failed(job_id, stage, error)
        print(f"[fail] {stage}: {error}", flush=True)


def _plain(value: Any) -> Any:
    """DynamoDB numbers come back as Decimal; turn them into ints and floats."""
    return json.loads(json.dumps(value, default=lambda d: int(d) if d == int(d) else float(d)))


class DynamoJobs:
    """Reads and patches job records in the single table."""

    def __init__(self, table: Any, clock=now_ms) -> None:
        self.table = table
        self.clock = clock

    def get(self, job_id: str) -> dict | None:
        item = self.table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}).get("Item")
        return _plain(item["job"]) if item else None

    def _patch(self, job_id: str, **fields: Any) -> None:
        fields["updatedAt"] = self.clock()
        names = {f"#{k}": k for k in fields}
        names["#job"] = "job"
        values = {f":{k}": Decimal(str(v)) if isinstance(v, float) else v for k, v in fields.items()}
        values[":now"] = values.pop(":updatedAt")
        sets = ", ".join(f"#job.#{k} = :{'now' if k == 'updatedAt' else k}" for k in fields)
        self.table.update_item(
            Key={"pk": f"JOB#{job_id}", "sk": "JOB"},
            UpdateExpression=f"SET {sets}",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(pk)",
        )

    def update(self, job_id: str, stage: str, percent: int) -> None:
        self._patch(job_id, status="running", stage=stage, percent=percent)

    def done(self, job_id: str, case_id: str) -> None:
        self._patch(job_id, status="done", stage="done", percent=100, caseId=case_id)

    def failed(self, job_id: str, stage: str, error: str) -> None:
        self._patch(job_id, status="failed", stage=stage, error=error[:1000])

    def is_done(self, job_id: str) -> bool:
        return (self.get(job_id) or {}).get("status") == "done"
