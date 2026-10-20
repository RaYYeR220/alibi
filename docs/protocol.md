# How Alibi meets the Alexa+ add-on contract

Alibi is built against the published Alexa+ MCP Toolkit, MCP Apps and checkout documentation.
Each row below is a requirement from those docs and where it is implemented.

| Requirement | How Alibi does it | Where |
|---|---|---|
| MCP spec 2025-11-25 over Streamable HTTP | One endpoint serves 2025-era clients statelessly | `packages/server/src/mcp/handler.ts` |
| Alexa's handshake still sends `protocolVersion: "2025-03-26"` | Accepted and negotiated; covered by a test and by the deployed smoke test | `packages/server/test/era.test.ts`, `packages/server/scripts/smoke.ts` |
| MCP 2026-07-28 (stateless, `server/discover`) | Same endpoint, same factory; missing custom-case details come back as `input_required` when the client can elicit | `packages/server/src/tools/custom.ts`, `packages/server/test/era2026.test.ts` |
| Round trip under 500 ms per query | No model call in any tool; deterministic engine plus one DynamoDB read and write. Deployed p95 from Europe to us-east-1: 222 ms | `packages/canon/src/engine/*`, `packages/server/scripts/smoke.ts` |
| Two-tier OAuth: client credentials (`mcp:service`) for catalog and guest play, authorization code + PKCE for household tools | Cognito user pool with a resource server (`alibi/mcp:service`, `alibi/mcp:tools`, `alibi/mcp:resources`) and three pre-registered clients | `infra/lib/auth-stack.ts`, `packages/server/src/auth/verifier.ts` |
| A tool that needs linking answers HTTP 401 without `WWW-Authenticate` | The gate returns a bare 401 for household tools called with a service token, for invalid tokens and for any non-discovery request without a token | `packages/server/src/http/gate.ts`, `packages/server/test/http.auth.test.ts` |
| Protected resource metadata (RFC 9728) and authorization server metadata | `/.well-known/oauth-protected-resource` (and `/mcp` suffix), `/.well-known/oauth-authorization-server` | `packages/server/src/http/wellknown.ts` |
| No DCR, no CIMD | Clients are pre-registered | `infra/lib/auth-stack.ts` |
| Guest experience without linking | The free case is fully playable on a service token; progress lives under a `game_id` | `packages/server/src/tools/*` |
| State must hang off your own ids (Alexa sessions are conversation-based) | Every play tool takes `game_id`; linked households can omit it and continue their latest game | `packages/server/src/tools/common.ts` |
| MCP Apps: `_meta.ui.resourceUri`, `ui://` resources, `text/html;profile=mcp-app` | Eleven single-file views, registered with `registerAppTool` / `registerAppResource` | `packages/apps`, `packages/server/src/apps/registry.ts` |
| Views load images and audio from your origin | `_meta.ui.csp.resourceDomains` declares the asset origin | `packages/server/src/apps/registry.ts` |
| Authoring size 768×480, root zoom 1.667 on Echo Show 8/15, far-field type | Views scale from host context; 1.6 type scale | `packages/apps/src/lib/scale.ts`, `theme.css` |
| Inline, fullscreen and voice-only modes | Cards inline, evidence board requests fullscreen, every tool returns complete spoken text | `packages/apps/src/views/board` |
| Carousels hold 3–5 items | Catalog capped at five | `packages/server/src/tools/catalog.ts` |
| Never say "tap"; every action has a voice equivalent | View copy suggests what to say; covered by view tests | `packages/apps/test` |
| UCP checkout 2026-04-08: `/.well-known/ucp`, `POST /checkout-sessions`, get, update, `/complete`, `/cancel` | Implemented under `/ucp`; profile declares the REST endpoint and both Amazon payment handlers | `packages/server/src/ucp/*` |
| `Idempotency-Key` on Create and Complete, stored 24 h; replay identical requests, 409 on a different body | Scoped per caller; covered by tests | `packages/server/src/ucp/routes.ts`, `packages/server/test/ucp.test.ts` |
| Payment decline: HTTP 200 + `incomplete` + `payment_failed` message | As specified | `packages/server/src/ucp/routes.ts` |
| Pay button in an MCP App sends `ui/message` "Pay for this order"; no payment UI, no payment data in the message | The purchase view does exactly that | `packages/apps/src/views/purchase` |
| Read-back before purchase | `buy_case` returns "<title> is $4.99. Want me to buy it?" | `packages/server/src/tools/buy.ts` |
| Purchases over $100 need a voice PIN | Played by the simulator's wallet phase (Alibi prices are below it) | `packages/simulator` |

## What is simulated

Alexa+'s MCP Toolkit, simulator and Amazon Wallet are only open to selected partners, so the
web simulator plays the host's part: it is a real MCP client of the deployed server, renders
the views through an MCP Apps bridge in a sandboxed iframe on a separate origin, and runs the
documented payment phase against the real UCP endpoints with a demo network token. The payment
processor behind the checkout accepts only those demo tokens; a real deployment swaps in a PSP
client behind the same interface (`packages/server/src/ucp/payment.ts`).

Alexa notifications are partner-gated too, so "lab results are in" is delivered to the
household inbox resource (`alibi://household/inbox`), which the simulator polls.
