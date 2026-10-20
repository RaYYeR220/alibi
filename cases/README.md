# Cases

Each case lives in its own folder as `case.json` plus its art and voice clips. The format is defined in
`packages/canon/src/schema.ts` and exported as JSON Schema to `packages/canon/dist/case.schema.json`.

| Case | Rating | Price | Suspects |
|---|---|---|---|
| `lakeside-heirloom` (The Loon Lake Lure) | family | free | 4 |
| `lighthouse-storm` (The Gull Rock Light) | teen | $4.99 | 5 |
| `blue-note` (The Last Set at the Blue Note) | teen | $4.99 | 4 |

Every case must pass, before it ships:

```sh
cd casegen && uv run alibi-validate ../cases/<id>/case.json            # one provable culprit, every lie exposable
node packages/canon/dist/cli.js lint cases/<id>/case.json              # 0 issues
node packages/canon/dist/cli.js redteam cases/<id>/case.json --runs 2000   # 0 guard violations
pnpm --filter @alibi/canon test                                        # property test covers every case here
```

`briefs/` holds the inputs each case was drafted from (`uv run alibi-generate --brief briefs/<id>.yaml --out <dir>`);
the drafts were then rewritten by hand. Play one end to end with `node packages/canon/dist/cli.js playtest cases/<id>/case.json`.
