"""Proves a case is fair before it ships.

Two layers:
  * reachability: a fixpoint over everything a player can do (search every place,
    present any found item to anyone, send items to the lab, keep asking) tells us
    which facts can ever be learned and which lies can ever be exposed;
  * logic: Z3 checks that, given every learnable fact, exactly one suspect is
    *proven* to have motive, means and opportunity while every other suspect is
    ruled out, that talking alone does not already prove it, and that the
    solution's minimal proof is actually needed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import z3

ATTRS = ("motive", "means", "opportunity")


@dataclass(frozen=True)
class Issue:
    code: str
    detail: str


@dataclass
class ProofReport:
    ok: bool
    unique_culprit: str | None
    issues: list[Issue] = field(default_factory=list)


@dataclass
class Closure:
    known: set[str]
    discovered: set[str]
    broken: set[str]
    lab_ready: set[str]
    unlocked_rows: set[int]


def _sayable_facts(case: dict) -> set[str]:
    return {f for t in case["topics"] for f in t["factIds"]}


def closure(case: dict, *, talk_only: bool = False, removed_evidence: frozenset[str] = frozenset()) -> Closure:
    evidence = {e["id"]: e for e in case["evidence"] if e["id"] not in removed_evidence}
    sayable = _sayable_facts(case)
    known: set[str] = set(case["meta"].get("startingFacts", []))
    discovered: set[str] = set()
    broken: set[str] = set()
    lab_ready: set[str] = set()
    unlocked_rows: set[int] = set()

    def met(cond: dict) -> bool:
        kind = cond["kind"]
        if kind == "fact_known":
            return cond["factId"] in known
        if talk_only:
            return False
        if kind in ("evidence_found", "evidence_presented"):
            return cond["evidenceId"] in discovered
        if kind == "lab_ready":
            return cond["evidenceId"] in lab_ready
        if kind == "lie_broken":
            return cond["lieId"] in broken
        return False

    changed = True
    while changed:
        before = (len(known), len(discovered), len(broken), len(lab_ready), len(unlocked_rows))
        if not talk_only:
            for e in evidence.values():
                if e.get("foundAt") or (e.get("givenBy") and e["givenBy"] in known):
                    discovered.add(e["id"])
            for eid in discovered:
                e = evidence[eid]
                known.update(e.get("implies", []))
                if e.get("lab"):
                    lab_ready.add(eid)
                    known.update(e["lab"]["resultFactIds"])
            for lie in case["lies"]:
                if lie["id"] not in broken and any(x in discovered for x in lie["exposedBy"]):
                    broken.add(lie["id"])
                    known.add(lie["contradicts"])
        shielded = {(l["suspectId"], l["contradicts"]) for l in case["lies"] if l["id"] not in broken}
        for i, k in enumerate(case["knowledge"]):
            if k["tier"] == "never" or k["factId"] not in sayable or (k["suspectId"], k["factId"]) in shielded:
                continue
            if all(met(u) for u in k.get("unlock") or []):
                unlocked_rows.add(i)
                known.add(k["factId"])
        changed = before != (len(known), len(discovered), len(broken), len(lab_ready), len(unlocked_rows))
    return Closure(known, discovered, broken, lab_ready, unlocked_rows)


def _logic_model(case: dict, known: set[str]):
    suspects = [s["id"] for s in case["suspects"]]
    v = {(s, a): z3.Bool(f"{a}_{s}") for s in suspects for a in ATTRS}
    culprit = z3.Int("culprit")
    solver = z3.Solver()
    for f in case["facts"]:
        logic = f.get("logic")
        if logic and f["id"] in known:
            solver.add(v[(logic["suspectId"], logic["attr"])] == z3.BoolVal(logic["holds"]))
    return suspects, v, culprit, solver


def _proven(solver: z3.Solver, v, suspect: str) -> bool:
    """Proven by the facts themselves: impossible for this suspect to lack any of the three.

    The "someone did it" axiom is deliberately absent here; ruling everyone else
    out is elimination, not proof.
    """
    solver.push()
    solver.add(z3.Not(z3.And([v[(suspect, a)] for a in ATTRS])))
    result = solver.check() == z3.unsat
    solver.pop()
    return result


def _possible(solver: z3.Solver, v, culprit, suspects: list[str], index: int) -> bool:
    """Could this suspect still be the culprit, given that the culprit has all three?"""
    solver.push()
    solver.add(culprit == index)
    solver.add(z3.And([v[(suspects[index], a)] for a in ATTRS]))
    result = solver.check() == z3.sat
    solver.pop()
    return result


def prove(case: dict) -> ProofReport:
    issues: list[Issue] = []
    target = case["solution"]["culprit"]

    full = closure(case)
    for eid in case["solution"]["minimalProof"]:
        if eid not in full.discovered:
            issues.append(Issue("unreachable_evidence", f"proof item {eid} can never be found"))
    for lie in case["lies"]:
        if lie["id"] not in full.broken:
            issues.append(Issue("unexposable_lie", f"lie {lie['id']} can never be exposed"))
    for i, k in enumerate(case["knowledge"]):
        if k["tier"] == "locked" and i not in full.unlocked_rows:
            issues.append(Issue("circular_lock", f"{k['suspectId']} never becomes willing to share {k['factId']}"))

    suspects, v, culprit, solver = _logic_model(case, full.known)
    if solver.check() != z3.sat:
        issues.append(Issue("contradictory_logic", "the learnable facts contradict each other"))
        return ProofReport(False, None, issues)

    proven = [s for s in suspects if _proven(solver, v, s)]
    still_possible = [s for i, s in enumerate(suspects) if _possible(solver, v, culprit, suspects, i)]
    unique = proven[0] if len(proven) == 1 and still_possible == proven else None

    if target not in proven:
        if any(s != target for s in proven):
            issues.append(Issue("wrong_culprit", f"the evidence proves {', '.join(p for p in proven if p != target)}, not {target}"))
        else:
            issues.append(Issue("not_unique", f"{target} is never proven; still possible: {', '.join(still_possible)}"))
    elif unique != target:
        others = [s for s in still_possible if s != target]
        issues.append(Issue("not_unique", f"{', '.join(others)} cannot be ruled out"))

    talk = closure(case, talk_only=True)
    _, tv, _, tsolver = _logic_model(case, talk.known)
    if tsolver.check() == z3.sat and _proven(tsolver, tv, target):
        issues.append(Issue("trivial", "talking alone proves the culprit"))

    without = closure(case, removed_evidence=frozenset(case["solution"]["minimalProof"]))
    _, wv, _, wsolver = _logic_model(case, without.known)
    if wsolver.check() == z3.sat and _proven(wsolver, wv, target):
        issues.append(Issue("proof_not_needed", "the culprit is proven even without the minimal proof"))

    return ProofReport(not issues, unique, issues)
