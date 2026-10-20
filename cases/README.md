# Cases

Each case lives in its own folder as `case.json` plus its art and voice clips. The format is defined in
`packages/canon/src/schema.ts` and exported as JSON Schema to `packages/canon/dist/case.schema.json`.

Every case must pass `alibi-validate` (solvable, single culprit, every lie can be exposed) and
`alibi-canon lint` before it ships.
