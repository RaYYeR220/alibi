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


def sealed_facts(case: dict) -> set[str]:
    """Facts no one ever volunteers and no evidence implies: only the ending may say them."""
    speakable = {k["factId"] for k in case["knowledge"] if k["tier"] != "never"}
    implied = {f for e in case["evidence"] for f in [*e.get("implies", []), *(e.get("lab") or {}).get("resultFactIds", [])]}
    starting = set(case["meta"].get("startingFacts", []))
    return {f["id"] for f in case["facts"]} - speakable - implied - starting


def open_cracks(case: dict) -> list[str]:
    """A lie about the culprit's motive, means or opportunity (or any lie by someone else) exists to be
    broken: if the writer sealed the fact it contradicts, let the liar admit it once the lie breaks.
    Lies hiding the crime itself stay flagged; cracking those would be a confession."""
    sealed = sealed_facts(case)
    sol = case["solution"]
    solution_facts = {sol["motiveFact"], sol["meansFact"], sol["opportunityFact"]}
    opened = []
    for lie in case["lies"]:
        fact = lie["contradicts"]
        if fact not in sealed or (lie["suspectId"] == sol["culprit"] and fact not in solution_facts):
            continue
        rows = [k for k in case["knowledge"] if k["suspectId"] == lie["suspectId"] and k["factId"] == fact]
        if not rows:
            rows = [{"suspectId": lie["suspectId"], "factId": fact}]
            case["knowledge"].append(rows[0])
        rows[0]["tier"] = "locked"
        rows[0]["unlock"] = [{"kind": "lie_broken", "lieId": lie["id"]}]
        opened.append(lie["id"])
    return opened


def structural_issues(case: dict) -> list[dict]:
    """Design mistakes the solver does not see but play would expose."""
    sealed = sealed_facts(case)
    return [
        {
            "code": "lie_reveals_secret",
            "detail": f"lie {lie['id']} contradicts {lie['contradicts']}, which only the ending may reveal; a crack must admit something smaller",
        }
        for lie in case["lies"]
        if lie["contradicts"] in sealed
    ]


def check(case: dict, deps: PipelineDeps) -> list[dict]:
    try:
        models.Case.model_validate(case)
    except ValidationError as err:
        return [{"code": "format", "detail": f"{'.'.join(map(str, e['loc']))}: {e['msg']}"} for e in err.errors()[:20]]
    issues = deps.canon.lint(case)
    if any(i["code"] == "format" for i in issues):
        return issues
    report = prove(case)
    return issues + structural_issues(case) + [{"code": i.code, "detail": i.detail} for i in report.issues]


def run(draft: Draft, deps: PipelineDeps) -> dict:
    case = draft.case or {}
    if drop_short_fingerprints(case):
        draft.notes.append("dropped fingerprints shorter than three words")
    opened = open_cracks(case)
    if opened:
        draft.notes.append(f"let {', '.join(opened)} admit the fact they hide once broken")
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
