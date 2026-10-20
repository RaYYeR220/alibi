"""Stage 3: check the compiled case (schema, cross-references, fingerprints, Z3 proof).

Issues go back to the compiler; after the last allowed attempt the job fails.
"""

from __future__ import annotations

import re

from pydantic import ValidationError

from .. import models
from ..pipeline import MAX_COMPILES, Draft, JobFailed, PipelineDeps
from ..prover import prove

SOLUTION_KINDS = {"motive", "means", "opportunity"}


def drop_short_fingerprints(case: dict) -> int:
    """Fingerprints under three words only cause false alarms; remove them outright."""
    dropped = 0
    for f in case.get("facts", []):
        keep = [fp for fp in f.get("fingerprints", []) if len(fp.split()) >= 3]
        dropped += len(f.get("fingerprints", [])) - len(keep)
        f["fingerprints"] = keep
    return dropped


def drop_colliding_fingerprints(case: dict, issues: list[dict]) -> bool:
    """Last resort on the final attempt: remove fingerprints that collide, if every solution fact keeps one."""
    facts = {f["id"]: f for f in case.get("facts", [])}
    plan: dict[str, set[str]] = {}
    for i in issues:
        if i["code"] != "fingerprint_collision":
            return False
        # detail: fingerprint "<fp>" of fact <id> appears in <where>
        try:
            fp = i["detail"].split('"')[1]
            fact_id = i["detail"].split(" of fact ")[1].split(" ")[0]
        except IndexError:
            return False
        plan.setdefault(fact_id, set()).add(fp)
    for fact_id, fps in plan.items():
        f = facts.get(fact_id)
        if f is None:
            return False
        keep = [x for x in f["fingerprints"] if _norm(x) not in fps]
        if not keep and f.get("kind") in SOLUTION_KINDS:
            return False
        f["fingerprints"] = keep
    return True


def _norm(text: str) -> str:
    """Same normalization as the canon guard: lowercase, apostrophes gone, punctuation to spaces."""
    return re.sub(r"[^a-z0-9]+", " ", re.sub(r"['’]", "", text.lower())).strip()


def check(case: dict, deps: PipelineDeps) -> list[dict]:
    try:
        models.Case.model_validate(case)
    except ValidationError as err:
        return [{"code": "format", "detail": f"{'.'.join(map(str, e['loc']))}: {e['msg']}"} for e in err.errors()[:20]]
    issues = deps.canon.lint(case)
    if any(i["code"] == "format" for i in issues):
        return issues
    report = prove(case)
    return issues + [{"code": i.code, "detail": i.detail} for i in report.issues]


def run(draft: Draft, deps: PipelineDeps) -> dict:
    case = draft.case or {}
    if drop_short_fingerprints(case):
        draft.notes.append("dropped fingerprints shorter than three words")
    issues = check(case, deps)
    if issues and draft.attempts >= MAX_COMPILES and drop_colliding_fingerprints(case, issues):
        draft.notes.append("dropped colliding fingerprints on the final attempt")
        issues = check(case, deps)
    draft.case = case
    draft.issues = issues
    draft.proven = not issues
    if not draft.proven and draft.attempts >= MAX_COMPILES:
        summary = "; ".join(f"{i['code']}: {i['detail']}" for i in issues[:5])
        raise JobFailed("prove", f"case could not be proven fair after {draft.attempts} attempts ({summary})")
    return {"proven": draft.proven, "attempts": draft.attempts}
