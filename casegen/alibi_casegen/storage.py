"""Where the pipeline keeps drafts, assets and finished cases.

Layout (S3 keys, mirrored on disk by LocalStorage):
  casegen/jobs/<jobId>/draft.json     working draft between Step Functions stages
  casegen/cases/<caseId>/case.json    the published case document
  assets/cases/<caseId>/<file>        portraits, evidence art, cover (served via /assets/*)
  assets/cases/<caseId>/audio/<a>.mp3 anchor voice clips

DynamoDB (single table, same items the MCP server reads):
  HH#<hh>/CASE#<caseId>               attribute `case`
  HH#<hh>/INBOX#<at, 15 digits>#<id>  attribute `item`
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path
from typing import Any, Protocol


def asset_key(case_id: str, name: str) -> str:
    return f"assets/cases/{case_id}/{name}"


def inbox_sort_key(item: dict) -> str:
    return f"INBOX#{str(int(item['at'])).zfill(15)}#{item['id']}"


class Storage(Protocol):
    def put_asset(self, case_id: str, name: str, data: bytes, content_type: str) -> str: ...
    def save_case(self, case: dict) -> None: ...
    def save_custom_case(self, household_id: str, case: dict) -> None: ...
    def add_inbox(self, household_id: str, item: dict) -> None: ...
    def refund_credit(self, household_id: str, job_id: str) -> None: ...
    def save_draft(self, job_id: str, text: str) -> None: ...
    def load_draft(self, job_id: str) -> str: ...


class LocalStorage:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _write(self, rel: str, data: bytes) -> Path:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def put_asset(self, case_id: str, name: str, data: bytes, content_type: str) -> str:
        key = asset_key(case_id, name)
        self._write(key, data)
        return key

    def save_case(self, case: dict) -> None:
        self._write(f"casegen/cases/{case['meta']['id']}/case.json", json.dumps(case, indent=2, ensure_ascii=False).encode())

    def save_custom_case(self, household_id: str, case: dict) -> None:
        self._write(f"households/{household_id}/cases/{case['meta']['id']}.json", json.dumps(case, ensure_ascii=False).encode())

    def custom_case(self, household_id: str, case_id: str) -> dict:
        return json.loads((self.root / f"households/{household_id}/cases/{case_id}.json").read_text(encoding="utf-8"))

    def add_inbox(self, household_id: str, item: dict) -> None:
        path = self.root / f"households/{household_id}/inbox.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(item) + "\n")

    def refund_credit(self, household_id: str, job_id: str) -> None:
        if job_id in self.refunds(household_id):
            return
        path = self.root / f"households/{household_id}/refunds.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(job_id) + "\n")

    def refunds(self, household_id: str) -> list[str]:
        path = self.root / f"households/{household_id}/refunds.jsonl"
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []

    def inbox(self, household_id: str) -> list[dict]:
        path = self.root / f"households/{household_id}/inbox.jsonl"
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []

    def save_draft(self, job_id: str, text: str) -> None:
        self._write(f"casegen/jobs/{job_id}/draft.json", text.encode())

    def load_draft(self, job_id: str) -> str:
        return (self.root / f"casegen/jobs/{job_id}/draft.json").read_text(encoding="utf-8")


def _dynamo(value: Any) -> Any:
    return json.loads(json.dumps(value), parse_float=Decimal)


class AwsStorage:
    def __init__(self, *, bucket: str, table: Any, s3: Any, asset_base_url: str | None = None) -> None:
        self.bucket = bucket
        self.table = table
        self.s3 = s3
        self.asset_base_url = asset_base_url.rstrip("/") if asset_base_url else None

    def put_asset(self, case_id: str, name: str, data: bytes, content_type: str) -> str:
        key = asset_key(case_id, name)
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type, CacheControl="public, max-age=31536000")
        return f"{self.asset_base_url}/{key}" if self.asset_base_url else key

    def save_case(self, case: dict) -> None:
        body = json.dumps(case, ensure_ascii=False).encode()
        self.s3.put_object(Bucket=self.bucket, Key=f"casegen/cases/{case['meta']['id']}/case.json", Body=body, ContentType="application/json")

    def save_custom_case(self, household_id: str, case: dict) -> None:
        self.table.put_item(Item={"pk": f"HH#{household_id}", "sk": f"CASE#{case['meta']['id']}", "case": _dynamo(case)})

    def add_inbox(self, household_id: str, item: dict) -> None:
        self.table.put_item(Item={"pk": f"HH#{household_id}", "sk": inbox_sort_key(item), "item": _dynamo(item)})

    def refund_credit(self, household_id: str, job_id: str) -> None:
        """Gives back the custom-case credit a failed job used; once per job, like the server's grants."""
        try:
            self.table.meta.client.transact_write_items(
                TransactItems=[
                    {
                        "Put": {
                            "TableName": self.table.name,
                            "Item": {"pk": f"ORDER#refund-{job_id}", "sk": "GRANT", "householdId": household_id, "sku": "custom-case"},
                            "ConditionExpression": "attribute_not_exists(pk)",
                        }
                    },
                    {
                        "Update": {
                            "TableName": self.table.name,
                            "Key": {"pk": f"HH#{household_id}", "sk": "ENT#custom-case"},
                            "UpdateExpression": "ADD credits :one SET lastOrder = :o",
                            "ExpressionAttributeValues": {":one": 1, ":o": f"refund-{job_id}"},
                        }
                    },
                ]
            )
        except self.table.meta.client.exceptions.TransactionCanceledException as err:
            reasons = err.response.get("CancellationReasons") or []
            if not reasons or reasons[0].get("Code") != "ConditionalCheckFailed":
                raise  # a real failure: let Step Functions retry
            # the refund marker already exists: this job was refunded before

    def save_draft(self, job_id: str, text: str) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=f"casegen/jobs/{job_id}/draft.json", Body=text.encode(), ContentType="application/json")

    def load_draft(self, job_id: str) -> str:
        return self.s3.get_object(Bucket=self.bucket, Key=f"casegen/jobs/{job_id}/draft.json")["Body"].read().decode()
