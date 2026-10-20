# Case format reference

The authoritative definition is `packages/canon/src/schema.ts` (also exported as JSON Schema at
`packages/canon/dist/case.schema.json`). Ids are lowercase letters, digits, `_` and `-`.

## Top level

| Field | Type | Notes |
|---|---|---|
| `meta` | object | `id`, `title`, `tagline`, `rating` (`family`/`teen`/`mature`), `minutes`, `priceCents` (0 = free), `author`, `cover`, `artStyle`, `setting`, `startingFacts` (fact ids the cold open establishes) |
| `victim` | object | `id`, `name`, `role`, `description`, optional `portrait` |
| `places` | array | `id`, `name`, `aliases` |
| `suspects` | 3–5 | `id`, `name`, `role`, `aliases`, `persona {traits, speech, demeanor}`, `voiceId` (Amazon Polly voice), `portrait` |
| `facts` | array | `id`, `text`, `about` (entity ids), `kind` (`event`, `state`, `relation`, `motive`, `means`, `opportunity`), optional `place`, `time`, `fingerprints`, `logic {suspectId, attr, holds}` |
| `topics` | array | `id`, `label`, `aliases`, `factIds` |
| `knowledge` | array | `suspectId`, `factId`, `tier` (`open`, `guarded`, `locked`, `never`), `unlock` (all must hold) |
| `lies` | array | `id`, `suspectId`, `topicId`, `claim`, `contradicts` (fact id), `exposedBy` (evidence ids, any one), `crackAnchorId` |
| `evidence` | array | `id`, `name`, `aliases`, `description`, `image`, `foundAt` (place) or `givenBy` (fact), `implies` (fact ids), optional `lab {resultFactIds, delayHours}` |
| `solution` | object | `culprit`, `motiveFact`, `meansFact`, `opportunityFact`, `minimalProof` (evidence ids) |
| `anchors` | array | `id`, `speakerId` (suspect id or `narrator`), `trigger` (`cold_open`, `crack`, `confession`, `ending_correct`, `ending_partial`, `ending_wrong`), optional `lieId`, `text`, optional `audioUrl` |

## Unlock conditions

```json
{ "kind": "evidence_found", "evidenceId": "e_key" }
{ "kind": "evidence_presented", "evidenceId": "e_key", "suspectId": "clara" }
{ "kind": "fact_known", "factId": "f_debts" }
{ "kind": "lab_ready", "evidenceId": "e_key" }
{ "kind": "lie_broken", "lieId": "l_clara" }
```

## Required anchors

Every case needs one `cold_open`, one `ending_correct`, one `ending_partial` and one
`ending_wrong`. Each lie needs its `crack` anchor. A `confession` anchor is played with a correct
verdict.

## How play maps onto the format

- *Asking* a suspect about a topic raises the pressure on that suspect and topic. Open facts come
  out at once, guarded facts on the second push, and locked facts once their conditions hold.
- *Searching* a place discovers the evidence `foundAt` there; evidence `implies` facts.
- *Showing* evidence to a suspect breaks every lie of theirs that the evidence `exposedBy`.
- *The lab* returns `resultFactIds` after `delayHours` of game time.
- *Accusing* is correct with the right culprit and at least one discovered `minimalProof` item;
  right culprit without proof is partial; two wrong accusations close the case.
