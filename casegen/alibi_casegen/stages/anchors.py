"""Stage 4: the lines spoken verbatim (cold open, cracks, confession, endings).

The writer polishes every anchor in the speaker's voice. A checker model then
lists the factual claims in each line and names the canon source it thinks
supports each one; the support is verified here by word overlap, not taken on
trust. A line with an unsupported claim is rewritten once, then replaced by a
plain line built from canon.
"""

from __future__ import annotations

import json
import re

from pydantic import BaseModel

from ..llmjson import ask_json
from ..pipeline import Draft, PipelineDeps

WRITER = """You write the lines that Alibi plays word for word: the narrator's cold open and endings, each suspect's
crack (the moment a lie breaks), and the culprit's confession. Each suspect sounds like their persona.

Rules for what a line may say:
- cold_open: only the setting and the starting facts. Under 70 words. End by handing the case to the players.
- crack: the speaker admits the fact their lie contradicted, and may add the facts listed under "reveals". Nothing about
  the solution beyond that. One to three sentences.
- confession: the culprit admits what they did and why, using the listed facts.
- ending_correct: the narrator wraps up using the solution facts.
- ending_wrong and ending_partial: no names of suspects and no facts. A short, wry line that sends players back to work.
- Never invent times, places, objects or events that are not in the facts you are given.
- Plain spoken English. No stock phrases ("tapestry", "delve", "a testament to").

Reply with JSON only: {"anchors": [{"id": "...", "text": "..."}]}"""

CHECKER = """You audit lines from a detective game against its case file. For each line, list every factual claim it makes:
who did what, where, when, with what, and who is related to whom. Skip feelings, opinions, excuses, intentions,
denials of guilt, questions, and anything about the future.

For each claim give the id of the source that states it: a fact id (f_...), "lie:<lie id>", "evidence:<evidence id>",
"suspect:<suspect id>", "victim", "setting" or "cast". Use null when nothing in the case file states it.
In an ending, skip how things turn out after the accusation (something returned, someone forgiven).

Reply with JSON only: {"claims": [{"anchor": "<anchor id>", "claim": "...", "source": "<id or null>"}]}"""

STOPWORDS = set(
    """a an and are as at be been but by did do does for from had has have he her hers him his how i if in into is it its
    me my of on or our she so than that the their them then there they this to too up was we were what when where which
    who whom why will with would you your all any just only very still also back out over again more most could should
    one ever never not no yes about""".split()
)
# Words people use when owning up ("what I said was not true") that carry no fact of their own.
META = set("story true untrue false said say says told tell claim claimed lie lied lying admit admitted really actually".split())
NUMBERS = ["no", "one", "two", "three", "four", "five", "six"]
UNCHECKED = {"ending_wrong", "ending_partial"}


class Claim(BaseModel):
    anchor: str
    claim: str
    source: str | None = None


class Claims(BaseModel):
    claims: list[Claim]


class Rewritten(BaseModel):
    anchors: list[dict]


def _stem(token: str) -> str:
    for suffix in ("ing", "ed", "es", "s"):
        if token.endswith(suffix) and len(token) - len(suffix) >= 3:
            return token[: -len(suffix)]
    return token


def content_tokens(text: str) -> set[str]:
    words = re.sub(r"[^a-z0-9]+", " ", re.sub(r"['’]s?\b", "", text.lower())).split()
    return {_stem(w) for w in words if w not in STOPWORDS and w not in META}


def coverage(claim: str, source: str) -> float:
    c = content_tokens(claim)
    return len(c & content_tokens(source)) / len(c) if c else 1.0


def sources_for(case: dict, speaker_id: str) -> dict[str, str]:
    """What a line spoken by `speaker_id` may draw on: canon truths, plus the speaker's own lies."""
    meta, victim = case["meta"], case["victim"]
    names = [s["name"] for s in case["suspects"]]
    out = {f["id"]: f["text"] for f in case["facts"]}
    out["setting"] = f"{meta.get('setting', '')} {meta.get('tagline', '')} {meta.get('title', '')}"
    out["victim"] = f"{victim['name']}, {victim['role']}. {victim.get('description', '')}"
    out["cast"] = f"{NUMBERS[len(names)] if len(names) < len(NUMBERS) else len(names)} people: {', '.join(names)}"
    for s in case["suspects"]:
        out[f"suspect:{s['id']}"] = f"{s['name']} is the {s['role']}"
    for e in case["evidence"]:
        out[f"evidence:{e['id']}"] = f"{e['name']}. {e['description']}"
    for p in case.get("places", []):
        out[f"place:{p['id']}"] = p["name"]
    speaker = next((s for s in case["suspects"] if s["id"] == speaker_id), None)
    for lie in case["lies"]:
        if speaker and lie["suspectId"] == speaker_id:
            # lies are first person; name the speaker so third-person claims about them match
            out[f"lie:{lie['id']}"] = f"{speaker['name']}: {lie['claim']}"
    return out


def _source_key(source: str | None, sources: dict[str, str]) -> str | None:
    """Accepts the checker's ids with or without their prefix ("e_x" or "evidence:e_x")."""
    if not source or source in sources:
        return source
    for prefix in ("evidence:", "lie:", "suspect:", "place:"):
        if f"{prefix}{source}" in sources:
            return f"{prefix}{source}"
    return None


def claim_supported(claim: str, source: str | None, sources: dict[str, str]) -> bool:
    key = _source_key(source, sources)
    if key is not None:
        # A speaker owning up to their own lie quotes it loosely ("what I said about the library was not true").
        needed = 0.4 if key.startswith("lie:") else 0.5
        if coverage(claim, sources[key]) >= needed:
            return True
    return max((coverage(claim, text) for text in sources.values()), default=0.0) >= 0.7


def _fact(case: dict, fact_id: str) -> dict:
    return next(f for f in case["facts"] if f["id"] == fact_id)


def reveals(case: dict, anchor: dict) -> list[str]:
    """Fact ids a line may state at its trigger."""
    trigger = anchor["trigger"]
    if trigger == "cold_open":
        return list(case["meta"].get("startingFacts", []))
    if trigger == "crack":
        lie = next((l for l in case["lies"] if l["crackAnchorId"] == anchor["id"] or l["id"] == anchor.get("lieId")), None)
        if not lie:
            return []
        unlocked = [
            k["factId"]
            for k in case["knowledge"]
            if k["suspectId"] == lie["suspectId"]
            and k["tier"] == "locked"
            and all(u["kind"] == "lie_broken" and u["lieId"] == lie["id"] for u in k.get("unlock", []))
        ]
        return list(dict.fromkeys([lie["contradicts"], *unlocked]))
    sol = case["solution"]
    if trigger == "confession":
        sealed = [k["factId"] for k in case["knowledge"] if k["suspectId"] == sol["culprit"] and k["tier"] == "never"]
        return [sol["motiveFact"], sol["meansFact"], sol["opportunityFact"], *sealed]
    if trigger == "ending_correct":
        return [sol["motiveFact"], sol["meansFact"], sol["opportunityFact"]]
    return []


def fallback(case: dict, anchor: dict) -> str:
    """A plain line built only from canon, used when a written line cannot be trusted."""
    trigger = anchor["trigger"]
    sol = case["solution"]
    culprit = next(s for s in case["suspects"] if s["id"] == sol["culprit"])
    if trigger == "cold_open":
        n = len(case["suspects"])
        return f"{case['meta']['setting']} {NUMBERS[n].capitalize() if n < len(NUMBERS) else n} people had the chance. One of them is lying to you."
    if trigger == "crack":
        texts = [_fact(case, f)["text"] for f in reveals(case, anchor)]
        return "All right. " + " ".join(texts)
    if trigger == "confession":
        return f"Fine. It was me. {_fact(case, sol['motiveFact'])['text']}"
    if trigger == "ending_correct":
        facts = " ".join(_fact(case, sol[k])["text"] for k in ("motiveFact", "meansFact", "opportunityFact"))
        return f"{culprit['name']} did it. {facts} Case closed."
    if trigger == "ending_partial":
        return "Right person, wrong moment. Without the proof in hand, that accusation will not hold. Keep digging."
    return "That accusation does not hold up. The real culprit is still in the room, and still smiling."


def _brief(case: dict, anchors: list[dict]) -> str:
    personas = {
        s["id"]: {"name": s["name"], "role": s["role"], "persona": s["persona"]} for s in case["suspects"]
    }
    items = []
    for a in anchors:
        item = {"id": a["id"], "trigger": a["trigger"], "speaker": personas.get(a["speakerId"], "narrator"), "draft": a["text"]}
        item["may_state"] = [_fact(case, f)["text"] for f in reveals(case, a)]
        if a["trigger"] == "crack":
            lie = next((l for l in case["lies"] if l["crackAnchorId"] == a["id"]), None)
            if lie:
                item["lie_being_broken"] = lie["claim"]
        items.append(item)
    return json.dumps({"title": case["meta"]["title"], "setting": case["meta"]["setting"], "anchors": items}, ensure_ascii=False, indent=1)


def _check(case: dict, anchors: list[dict], deps: PipelineDeps) -> dict[str, list[str]]:
    """Unsupported claims per anchor id."""
    listing = json.dumps(
        {
            "case": {
                "facts": {f["id"]: f["text"] for f in case["facts"]},
                "lies": {l["id"]: {"suspect": l["suspectId"], "claim": l["claim"]} for l in case["lies"]},
                "evidence": {e["id"]: f"{e['name']}. {e['description']}" for e in case["evidence"]},
                "suspects": {s["id"]: f"{s['name']}, {s['role']}" for s in case["suspects"]},
                "victim": f"{case['victim']['name']}, {case['victim']['role']}",
                "setting": case["meta"]["setting"],
            },
            "lines": [{"anchor": a["id"], "speaker": a["speakerId"], "text": a["text"]} for a in anchors],
        },
        ensure_ascii=False,
    )
    found = ask_json(deps.llm, "checker", "anchors-check", CHECKER, listing, validate=Claims.model_validate)
    speaker = {a["id"]: a["speakerId"] for a in anchors}
    bad: dict[str, list[str]] = {}
    for c in found.claims:
        if c.anchor not in speaker:
            continue
        if not claim_supported(c.claim, c.source, sources_for(case, speaker[c.anchor])):
            bad.setdefault(c.anchor, []).append(c.claim)
    return bad


def _apply(anchors: list[dict], texts: list[dict]) -> None:
    by_id = {a["id"]: a for a in anchors}
    for t in texts:
        if t.get("id") in by_id and isinstance(t.get("text"), str) and t["text"].strip():
            by_id[t["id"]]["text"] = t["text"].strip()


def run(draft: Draft, deps: PipelineDeps) -> None:
    case = draft.case or {}
    anchors = case["anchors"]
    written = ask_json(deps.llm, "writer", "anchors", WRITER, _brief(case, anchors), validate=Rewritten.model_validate)
    _apply(anchors, written.anchors)

    # Wrong and partial endings carry no facts by design; the spoiler guard covers them.
    checked = [a for a in anchors if a["trigger"] not in UNCHECKED]
    report: dict = {"checked": len(checked), "rewritten": [], "dropped": [], "lint": []}
    bad = _check(case, checked, deps)
    if bad:
        flagged = [a for a in anchors if a["id"] in bad]
        request = (
            "These lines state things the case file does not support. Rewrite each one without them, keeping the voice.\n"
            + json.dumps({"lines": [{"id": a["id"], "text": a["text"], "unsupported": bad[a["id"]]} for a in flagged]}, ensure_ascii=False)
            + "\n\nCase brief:\n"
            + _brief(case, flagged)
        )
        again = ask_json(deps.llm, "writer", "anchors", WRITER, request, validate=Rewritten.model_validate)
        _apply(anchors, again.anchors)
        report["rewritten"] = [a["id"] for a in flagged]
        still = _check(case, flagged, deps)
        for a in flagged:
            if a["id"] in still:
                a["text"] = fallback(case, a)
                report["dropped"].append(a["id"])

    # A line that trips the spoiler lint is replaced by its canon fallback.
    for issue in deps.canon.lint(case):
        m = re.search(r"appears in anchor (\S+)", issue.get("detail", ""))
        if m:
            a = next(x for x in anchors if x["id"] == m.group(1))
            a["text"] = fallback(case, a)
            report["lint"].append(a["id"])
    draft.anchor_report = report
