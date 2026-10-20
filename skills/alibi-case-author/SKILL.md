---
name: alibi-case-author
description: Write, fix or review an Alibi detective case (a case.json for the Alibi Alexa+ add-on). Use when someone wants to author a new mystery, turn a premise into a playable case, or make an existing case pass validation.
---

# Writing an Alibi case

An Alibi case is a closed world in one JSON file. The game never improvises the truth: a
deterministic engine decides what each suspect is willing to say right now, and the voice
assistant only performs those lines. Your job is to write that world so it is fair, solvable
by exactly one line of reasoning, and fun to interrogate out loud.

Read `reference/schema.md` for every field, and keep `reference/example-case.json` open as a
worked example (a small but complete case that passes every check).

## Workflow

1. **Premise.** One crime (family cases: a theft, sabotage or disappearance, never a murder),
   one setting, one evening. Write the solution first: culprit, motive, means, opportunity.
2. **Cast.** 3 to 5 suspects. Give each a role, a voice (`persona.speech`), traits and a
   reason to be nervous that has nothing to do with the crime: the red herrings.
3. **Facts.** Atomic true sentences. Mark the culprit's motive, means and opportunity facts
   with `logic` (`{suspectId, attr, holds: true}`), and give every innocent suspect at least one
   fact that rules them out (`holds: false`).
4. **Knowledge.** Who knows which fact, and how willing they are to say it:
   - `open`: said on the first question about the topic;
   - `guarded`: said only when the player presses (asks about the topic a second time);
   - `locked`: said only after `unlock` conditions (evidence found, evidence shown to them, a lab
     result, another fact known, or one of their lies broken);
   - `never`: only the ending says it.
5. **Lies.** Each lie belongs to one suspect and one topic, contradicts one true fact, and is
   exposed by specific evidence (`exposedBy`). When the player shows that evidence, the suspect
   cracks: their `crack` anchor plays word for word and the contradicted fact becomes known.
6. **Evidence.** Things found in places (`foundAt`) or handed over through a fact (`givenBy`).
   Evidence can `imply` facts, and lab evidence returns facts after `delayHours` of game time.
   Lab results are meant to come back "tomorrow morning", so 8 to 14 hours is typical; players
   on the simulator can skip ahead.
7. **Solution.** `minimalProof` is the evidence a player must cite to make a correct
   accusation (citing any one discovered item of it is enough at accusation time). As a set it
   must be needed: with every `minimalProof` item removed, the culprit must not be provable.
8. **Topics.** What players actually say out loud. Aliases matter more than labels: "where were
   you", "at nine", "alibi", "this evening".
9. **Anchors.** The cold open, every crack, the confession and the three endings. These are the
   only lines read verbatim, so write them for the ear.
10. **Fingerprints.** For every motive, means and opportunity fact, add two or three short
    phrases (three words or more) that would give the fact away if anyone said them early. The
    server blocks any response containing a fingerprint of a fact the player hasn't earned.
    The lint checks every text a player can hear before earning the fact: the setting and
    tagline, other facts, lie claims, evidence names and descriptions, topic labels, personas and
    the cold open. A crack anchor may contain fingerprints of the facts that crack reveals; the
    confession and the endings are exempt, because they only play once the case is closed.

## Fair-play rules the checks enforce

- Exactly one suspect is proven to have motive, means and opportunity; everyone else is ruled
  out by at least one fact.
- Talking alone never proves the culprit (the case is not trivial).
- Without `minimalProof`, the culprit is not proven (the proof is needed).
- Every lie can be exposed by evidence the player can actually find.
- Every locked fact can actually be unlocked; no circular locks.
- No fingerprint appears in any line a player can hear before the fact is earned.

## Validate and playtest

```bash
scripts/validate.sh path/to/case.json   # schema, Z3 fair-play proof, fingerprint lint
scripts/playtest.sh path/to/case.json   # play it in the terminal against the real engine
```

Iterate until `validate.sh` prints `ok` and `0 issues`, then play it to a correct verdict. The
validator's messages name the exact field to fix (`knowledge[4].factId`, `unexposable_lie`,
`not_unique`, `trivial`, `proof_not_needed`, `fingerprint_collision`).

## Writing for the ear

- Suspects should sound different from each other in a sentence or two.
- Lies should be plausible, specific and checkable: "I was in the library with a novel all
  evening", not "I wasn't there".
- Cracks are confessions of the smaller thing, not the crime: the lie breaks, the mystery doesn't.
- Avoid stock phrases. Concrete nouns, short sentences, period-appropriate words.
