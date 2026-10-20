import copy
import json
from pathlib import Path

import pytest

from alibi_casegen.prover import prove

TINY = Path(__file__).resolve().parents[2] / "packages" / "canon" / "test" / "fixtures" / "tiny-case.json"


@pytest.fixture
def tiny() -> dict:
    return json.loads(TINY.read_text(encoding="utf-8"))


def codes(report) -> list[str]:
    return [i.code for i in report.issues]


def knowledge(case: dict, suspect: str, fact: str) -> dict:
    return next(k for k in case["knowledge"] if k["suspectId"] == suspect and k["factId"] == fact)


def test_tiny_case_is_valid(tiny):
    report = prove(tiny)
    assert report.issues == []
    assert report.ok
    assert report.unique_culprit == "clara"


def test_second_consistent_suspect_is_not_unique(tiny):
    pantry = next(f for f in tiny["facts"] if f["id"] == "f_perkins_pantry")
    del pantry["logic"]
    report = prove(tiny)
    assert not report.ok
    assert "not_unique" in codes(report)


def test_evidence_behind_its_own_lock_is_circular(tiny):
    k = knowledge(tiny, "clara", "f_clara_study")
    k["unlock"] = [{"kind": "fact_known", "factId": "f_clara_study"}]
    # without the crack revealing it, the only path to the fact is through itself
    tiny["lies"] = [l for l in tiny["lies"] if l["id"] != "l_clara"]
    tiny["anchors"] = [a for a in tiny["anchors"] if a["id"] != "a_clara_crack"]
    report = prove(tiny)
    assert "circular_lock" in codes(report)


def test_case_solvable_by_talking_alone_is_trivial(tiny):
    tiny["knowledge"].append({"suspectId": "perkins", "factId": "f_clara_study", "tier": "open"})
    tiny["knowledge"].append({"suspectId": "perkins", "factId": "f_key_perfume", "tier": "open"})
    for t in tiny["topics"]:
        if t["id"] == "t_others":
            t["factIds"] += ["f_clara_study", "f_key_perfume"]
    report = prove(tiny)
    assert "trivial" in codes(report)


def test_removing_proof_keeps_proven_is_flagged(tiny):
    tiny["knowledge"].append({"suspectId": "harold", "factId": "f_key_perfume", "tier": "guarded"})
    tiny["knowledge"].append({"suspectId": "harold", "factId": "f_clara_study", "tier": "locked", "unlock": [{"kind": "evidence_found", "evidenceId": "e_muddy_prints"}]})
    for t in tiny["topics"]:
        if t["id"] == "t_others":
            t["factIds"] += ["f_key_perfume", "f_clara_study"]
    report = prove(tiny)
    assert "proof_not_needed" in codes(report)


def test_lie_with_unreachable_exposer_is_unexposable(tiny):
    tiny["evidence"].append(
        {"id": "e_ghost", "name": "ghost", "description": "never found", "image": "x.png", "givenBy": "f_clara_took", "implies": []}
    )
    next(l for l in tiny["lies"] if l["id"] == "l_harold")["exposedBy"] = ["e_ghost"]
    report = prove(tiny)
    assert "unexposable_lie" in codes(report)


def test_wrong_culprit_is_reported(tiny):
    tiny["solution"]["culprit"] = "harold"
    assert "wrong_culprit" in codes(prove(copy.deepcopy(tiny)))
