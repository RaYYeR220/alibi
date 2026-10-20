"""Stage 2: expand the plot into a full case document.

The writer produces the narrative and logic; house fields (ids, prices, asset
names, voices) are filled in deterministically afterwards. On a retry the
previous draft and the checker's issues go back to the writer.
"""

from __future__ import annotations

import json
import re
from functools import cache

from ..llmjson import ask_json
from ..paths import EXAMPLE_CASE
from ..pipeline import Draft, PipelineDeps
from .voices import assign_voices

SYSTEM_HEAD = """You turn a detective plot into a case file for Alibi, a game played aloud. A deterministic engine
decides what each suspect may say, and a checker proves the case is fair before it ships. Your JSON is that case file.

HOW PLAY WORKS
- Asking a suspect about a topic: they state the facts in that topic which they know, by tier:
  open = always; guarded = only on the second question on that topic; locked = once every unlock condition holds;
  never = not at all. While a suspect's lie on a topic is unbroken, they tell the lie and hold back the fact it contradicts.
- Searching a place finds the evidence whose foundAt is that place. Finding evidence makes its "implies" facts known.
- Presenting evidence listed in a lie's exposedBy to that liar breaks the lie: the crack line plays, the contradicted
  fact becomes known, and so do the liar's locked facts that unlock on {"kind": "lie_broken", "lieId": ...}.
- Sending lab evidence away returns its resultFactIds after delayHours.
- Accusing: right culprit plus at least one item from solution.minimalProof wins.

PROOF RULES (checked by a solver; a case that breaks one is sent back to you)
1. Facts of kind motive, means or opportunity carry "logic": {"suspectId", "attr", "holds"}.
   The culprit has three of them with holds true: solution.motiveFact, meansFact, opportunityFact.
   Every other suspect has at least one with holds false (a confirmed alibi, no access, no reason) that players can learn.
2. A fact is learnable if it is a starting fact, implied by findable evidence, a lab result, the contradicted fact of a
   lie that can be broken, or listed in a topic and known by a suspect as open, guarded, or locked with reachable conditions.
3. Talking alone must not prove the culprit: before any evidence is found and any lie is broken, at least one of the
   culprit's three facts must still be out of reach.
4. The minimal proof must be needed: remove the minimalProof evidence from the game and the culprit must no longer be
   provable. The usual shape: the means fact is the lab result of one proof item; the opportunity fact is the contradicted
   fact of the culprit's lie, which only the other proof item exposes. Nobody states those two facts openly.
5. Every lie's exposedBy evidence can be found. Every locked row has unlock conditions that can be met. No circular locks.

SPOILER RULES (a guard scans every response for each fact's text and fingerprints until the player has learned it)
- fingerprints: one or two phrases of 3 to 6 words copied verbatim from the fact's own text and specific to it.
  Required on motive, means and opportunity facts; give them to every fact that matters.
- A fingerprint must not appear in anything a player hears before learning that fact: other facts, lie claims,
  evidence names and descriptions (except the facts that evidence implies), topic labels, personas, the cold open,
  crack lines (except the facts that crack reveals), or the wrong and partial endings.
- Evidence descriptions say what the item looks like and where it was, never what the lab will find or what it proves.
- Lie claims never hint at the truth. Wrong and partial endings never name the culprit or restate a fact.

WRITING
- 4 suspects unless the plot says otherwise; 18 to 28 facts; 6 to 9 topics; 5 to 7 evidence items, one with "lab"
  (delayHours between 8 and 16); 2 or 3 lies, one of them the culprit's.
- Fact text: one plain sentence in the third person that names who it is about.
- Every suspect has 4 to 8 knowledge rows across several topics, mostly open or guarded everyday facts, so every
  suspect has something to say. The culprit's own guilt (what they did, why) is tier never for the culprit.
- Topics: short labels; 6 to 12 aliases each, written the way people ask out loud ("where were you", "after dinner",
  "the key", "money", "did you see anyone"). Single keywords count.
- Suspect aliases: first name, surname, title and surname, "the <role>".
- Place and evidence aliases: every way a player might say them ("the boot prints", "footprints", "mud").
- Personas: three traits, a speech line with concrete habits, a demeanor word.
- Anchors: cold_open (narrator, under 70 words, states the setting and the starting facts, ends with the challenge);
  one crack per lie (speakerId = the liar, lieId set, one to three sentences in their voice admitting the contradicted
  fact); confession (the culprit); ending_correct, ending_wrong, ending_partial (narrator).
- Specific, period-true, a little funny. No stock phrases ("tapestry", "delve", "a testament to", "web of lies").
- ids are lowercase letters, digits, _ and -. Prefixes: f_ facts, t_ topics, l_ lies, e_ evidence, a_ anchors.

Reply with the case as one JSON object in a ```json block. Leave out cover, artStyle, author, priceCents, portrait,
voiceId, image and audioUrl; they are filled in for you.

Here is a small worked example (3 suspects, smaller than yours should be):
"""

ISSUE_HELP = {
    "not_unique": "another suspect cannot be ruled out: give them a learnable fact with logic holds false",
    "wrong_culprit": "the facts prove a different suspect: fix the logic values",
    "trivial": "talking alone proves the culprit: put one of the culprit's facts behind evidence, a lab result or a broken lie",
    "proof_not_needed": "the culprit is provable without the minimal proof: make the culprit's means or opportunity reachable only through the minimalProof items",
    "unreachable_evidence": "a proof item can never be found: give it a foundAt place",
    "unexposable_lie": "a lie can never be broken: its exposedBy evidence must be findable",
    "circular_lock": "a locked fact never unlocks: check its unlock conditions",
    "contradictory_logic": "two learnable facts set the same logic value both ways",
    "fingerprint_collision": "a fingerprint shows up in text heard before the fact is learned: change the fingerprint or the other text",
    "short_fingerprint": "fingerprints need at least three words",
    "format": "the document does not match the format",
    "lie_reveals_secret": "breaking that lie would confess the crime mid-game: make the lie contradict where the culprit was, not what they did",
}


@cache
def system_prompt() -> str:
    example = json.loads(EXAMPLE_CASE.read_text(encoding="utf-8"))
    return SYSTEM_HEAD + json.dumps(example, ensure_ascii=False)


def slug(text: str, limit: int = 32) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:limit].strip("-") or "case"


def case_id_for(draft: Draft, title: str) -> str:
    if draft.job.case_id:
        return draft.job.case_id
    tail = re.sub(r"[^a-z0-9]", "", draft.job.job_id.lower())[-6:]
    return f"custom-{slug(title, 24)}-{tail}"


def normalize_case(body: dict, *, case_id: str, price_cents: int, rating: str, voices: dict[str, str]) -> dict:
    """Fills the house fields the writer leaves out and drops anything the pipeline owns."""
    c = json.loads(json.dumps(body))
    meta = c.setdefault("meta", {})
    meta.update(id=case_id, priceCents=price_cents, rating=rating, author="Alibi", cover="cover.png", artStyle="ink-gouache")
    meta.setdefault("minutes", 25)
    meta.setdefault("startingFacts", [])
    victim = c.get("victim") or {}
    if victim.get("id"):
        victim["portrait"] = f"{victim['id']}.png"
    for s in c.get("suspects", []):
        s["portrait"] = f"{s['id']}.png"
        s["voiceId"] = voices.get(s["id"], s.get("voiceId", "Matthew"))
        s.setdefault("aliases", [])
    for e in c.get("evidence", []):
        e["image"] = f"{re.sub(r'^e_', '', e['id']).replace('_', '-')}.png"
        e.setdefault("aliases", [])
        e.setdefault("implies", [])
    for p in c.get("places", []):
        p.setdefault("aliases", [])
    for f in c.get("facts", []):
        f.setdefault("fingerprints", [])
        f.setdefault("about", [])
    for t in c.get("topics", []):
        t.setdefault("aliases", [])
    for a in c.get("anchors", []):
        a.pop("audioUrl", None)
    return c


def _genders(plot: dict | None, suspects: list[dict]) -> list[dict]:
    by_name = {s["name"].lower(): s.get("gender") for s in (plot or {}).get("suspects", [])}
    out = []
    for i, s in enumerate(suspects):
        gender = by_name.get(s.get("name", "").lower())
        if gender is None:
            first = s.get("name", "").lower().split(" ")[0]
            gender = next((g for n, g in by_name.items() if n.split(" ")[0] == first), None)
        out.append({"id": s["id"], "gender": gender or ("female" if i % 2 else "male")})
    return out


def prompt_for(draft: Draft) -> str:
    parts = ["PLOT", json.dumps(draft.plot, ensure_ascii=False, indent=1)]
    if draft.case and draft.issues:
        parts += [
            "",
            "YOUR PREVIOUS CASE FILE",
            json.dumps(draft.case, ensure_ascii=False),
            "",
            "THE CHECKER FOUND THESE PROBLEMS. Fix every one and send the whole corrected case file:",
        ]
        for i in draft.issues:
            hint = ISSUE_HELP.get(i["code"], "")
            parts.append(f"- {i['code']}: {i['detail']}" + (f" ({hint})" if hint else ""))
    return "\n".join(parts)


def run(draft: Draft, deps: PipelineDeps) -> None:
    body = ask_json(deps.llm, "writer", "compile", system_prompt(), prompt_for(draft), validate=_shape)
    title = body.get("meta", {}).get("title") or (draft.plot or {}).get("title", "case")
    draft.voices = assign_voices(_genders(draft.plot, body.get("suspects", [])))
    draft.case = normalize_case(
        body,
        case_id=case_id_for(draft, title),
        price_cents=draft.job.price_cents,
        rating=draft.job.rating,
        voices=draft.voices,
    )
    draft.attempts += 1
    draft.proven = False


def _shape(data: object) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get("suspects"), list) or not isinstance(data.get("facts"), list):
        raise ValueError("expected a case object with suspects and facts")
    for s in data["suspects"]:
        if not isinstance(s, dict) or "id" not in s:
            raise ValueError("every suspect needs an id")
    for e in data.get("evidence", []):
        if not isinstance(e, dict) or "id" not in e:
            raise ValueError("every evidence item needs an id")
    return data
