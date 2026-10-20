# Alexa+ add-on (MCP Toolkit path) and AWS friction log

| Reviewer | Status |
| :--- | :--- |
| **Yehor** | Complete |
| **Alexa+ developer experience, AWS** | Under review |

## BLUF (bottom line up front)

The Alexa+ add-on documentation is the most concrete agent-platform documentation I have built
against: real latency budgets, display sizes, checkout payloads and idempotency rules. The two
things that cost the most time were outside it: every Alexa+ tool that would let me run an
add-on on a real device is partner-gated, so I had to build and validate against my own host;
and a new AWS account hit four separate account-level restrictions (Bedrock, AgentCore quotas,
CloudFront, Lambda concurrency) that each surfaced as a different error at a different moment.

**Grade:** B

## Persona

- **Role:** Senior engineer building an Alexa+ add-on as a self-hosted MCP server.
- **Experience with this product:** First Alexa+ add-on; experienced with MCP, AWS and TypeScript.
- **Goal:** Ship a game add-on that uses MCP Apps, account linking, in-conversation checkout and state across sessions, hosted on AWS.
- **Technical context:** New AWS account, Windows dev machine, MCP TypeScript SDK v2, ext-apps 2.0.

## Scope

- [x] Stand up a Streamable HTTP MCP server that accepts Alexa's documented handshake
- [x] Two-tier OAuth (client credentials + authorization code with PKCE) and account linking
- [x] MCP App views sized for Echo Show, with voice-only parity
- [x] UCP checkout endpoints and the Pay button flow
- [x] Long-running work and "come back tomorrow" state
- [x] Host everything on AWS and keep it under the 500 ms budget

## Pros

- The latency budget (under 500 ms per round trip), the display sizes (768×480, root zoom 1.667) and the carousel rules (3–5 items, first within 500 ms) are stated as numbers. That shaped the architecture on day one: Alibi never calls a model inside a tool.
- The checkout reference is excellent: full request and response bodies, status lifecycle, decline semantics (HTTP 200 + `payment_failed`), and idempotency rules with the exact 409 body.
- "Pay button sends `ui/message`, never build payment UI" is a clear, safe contract.
- The MCP Apps design guide ("one title, one or two fields, one action", far-field type scale, "never say tap") is practical and easy to test against.
- The MCP TypeScript SDK v2 serves 2025-era and 2026-07-28 clients from one factory with `createMcpHandler`. Alexa's `2025-03-26` handshake worked against it unchanged.
- Amazon Polly generative voices made per-suspect voices trivial; EventBridge Scheduler one-time schedules with `ActionAfterCompletion: DELETE` are a perfect fit for "lab results arrive tomorrow".
- AgentCore Identity's API-key credential provider let me keep the third-party model key out of every function configuration, and it works from Lambda through a workload identity, not only inside AgentCore Runtime.

## Cons

- No way to run an add-on on a real Alexa+ device or in the Alexa+ simulator without partner access.
- A few places where the Alexa+ docs, the MCP spec and the official SDK disagree (handshake version, 401 header, `ui/message` shape, scope strings).
- New-account AWS restrictions surface one by one, with unrelated error messages.

## Friction

### Every tool for testing a real add-on is partner-gated

**Severity:** 🔥 Critical

The MCP Toolkit, the Alexa+ AI CLI, the Local Inspector, the web simulator and Amazon Wallet are all limited to selected partners. I implemented the documented contract, then had to build a web host that plays Alexa's part (an MCP client, an MCP Apps bridge in a sandboxed iframe, and the payment phase) to exercise it.

**Expected:** A sandbox Local Inspector or simulator for any developer account, even without publishing.

**Actual:** No way to confirm the add-on works on Alexa+ before a partner agreement.

**Recommendation:** Open the Local Inspector (or a hosted inspector) to all developers, with a test Amazon Wallet instrument.

### Handshake version vs. required spec version

**Severity:** ⚠️ High

The docs require spec 2025-11-25, while the documented client handshake sends `protocolVersion: "2025-03-26"` and the Local Inspector uses 2025-06-18.

**Expected:** One version, or an explicit statement that servers must accept older handshakes and which features Alexa actually uses.

**Actual:** I wrote a test that accepts `2025-03-26` and negotiates, and served 2026-07-28 from the same endpoint just in case.

**Recommendation:** Publish a capability matrix: protocol versions Alexa sends, plus elicitation (form or URL), tasks, notifications and `input_required` support.

### 401 without `WWW-Authenticate` fights the official SDK

**Severity:** ⚠️ High

Alexa starts account linking on a 401 that has no `WWW-Authenticate` header. The MCP SDK's `requireBearerAuth` always adds the challenge header, as the MCP spec suggests.

**Expected:** Either Alexa accepts a standard challenge, or the docs give a reference gate.

**Actual:** I wrote a custom fail-closed gate: per-method scope checks, and a bare 401 for household tools called with a service token.

**Recommendation:** Accept a standard `WWW-Authenticate` challenge on 401, or publish a reference middleware for the official SDK.

### Scope strings vs. real identity providers

**Severity:** ⚡ Medium

The docs name the tier-1 scope `mcp:service`. Amazon Cognito, the obvious IdP on AWS, can only issue resource-server scopes with a prefix (`alibi/mcp:service`).

**Expected:** Guidance on whether Alexa requests the exact strings, or reads them from protected resource metadata.

**Actual:** I advertise Cognito's real scope strings in the metadata and map them back to bare names in the verifier.

**Recommendation:** State that scopes are configurable per add-on, and include a Cognito example.

### `ui/message` content shape

**Severity:** ⚡ Medium

The checkout docs show `ui/message` with `content` as an object (`{type, text}`). The MCP Apps SDK's AppBridge expects an array of content blocks and rejects the object form.

**Expected:** The same shape in the Alexa docs and the MCP Apps spec.

**Actual:** The purchase button sends the documented object form. Every other button sends the array form, and my host handles both.

**Recommendation:** Align the example with the MCP Apps spec, or document that Alexa accepts both.

### Content security policy for MCP App assets

**Severity:** ⚡ Medium

Nothing in the Alexa+ docs says how views may load images and audio. Strict hosts block them unless the resource declares `_meta.ui.csp.resourceDomains`.

**Expected:** A note in the display-modes or components page.

**Actual:** I declared the asset origin on every view resource.

**Recommendation:** Document the CSP fields Alexa honours, and any size limits.

### Notifications for add-ons

**Severity:** ⚡ Medium

"Closing the loop" mentions Alexa notifications, but there is no API for an MCP Toolkit add-on to send one.

**Expected:** A way to say "the lab results are in" the next morning.

**Actual:** A household inbox resource that the host polls.

**Recommendation:** Support MCP resource subscriptions (`resources/updated`) as a notification source, or document the notification API for add-ons.

### Four account-level restrictions on a new AWS account

**Severity:** 🔥 Critical

On a new pay-as-you-go account, each of these failed separately:
- **Amazon Bedrock:** `Converse` returned `ValidationException: Operation not allowed` for every model, including Amazon Nova, from two IAM users. Support could not resolve it.
- **AgentCore Runtime:** creation failed with `402 maxAgents limit exceeded`. Service Quotas showed 0 for runtimes, memories, evaluations, browser and code interpreter.
- **CloudFront:** "Your account must be verified before you can add new CloudFront resources."
- **Lambda provisioned concurrency:** blocked, because the account concurrency limit was 10.

**Expected:** One clear "this account is restricted until verified" signal, with a single path to lift it.

**Actual:**
- The model calls moved to another OpenAI-compatible provider, with its key in AgentCore Identity.
- Case generation runs on Lambda and Step Functions instead of AgentCore Runtime.
- The API is served from a Lambda Function URL instead of CloudFront.
- A scheduled warmer replaces provisioned concurrency.

**Recommendation:** Show account-level restrictions on one page in the console (Service Quotas or Billing), with the verification request link, before developers hit them service by service.

### AgentCore Runtime architecture vs. scientific Python wheels

**Severity:** ℹ️ Low

AgentCore Runtime needs arm64 images, and `z3-solver`'s aarch64 wheel needs glibc 2.38. The documented Debian bookworm base images fail to install it.

**Recommendation:** Mention the base-image choice (Debian trixie works) in the container guide.

### AgentCore Identity outside Runtime

**Severity:** ℹ️ Low

The Python SDK's `IdentityClient.get_api_key` is a coroutine, while `get_workload_access_token` is synchronous. Calling it from a Lambda handler needed `asyncio.run`, and the docs only show the Runtime decorator.

**Recommendation:** Add a "use Identity from Lambda or ECS" example.

## Questions

- Which protocol versions and optional MCP features (elicitation modes, tasks, `input_required`, resource subscriptions) does Alexa+ use today?
- Can an add-on play its own audio clip in an MCP App while Alexa is speaking, and how does Alexa sequence the two?
- Does Alexa read scopes from protected resource metadata, or must they be configured in the console?
- What are the size limits for a `ui://` resource on Echo Show?

## Recommendations

1. Open a Local Inspector or simulator to all developers, with a test wallet instrument.
2. Publish a capability matrix for the Alexa MCP client.
3. Align the 401 and `ui/message` rules with the MCP spec and SDKs, or ship reference middleware.
4. Surface new-account AWS restrictions in one place, with one verification flow.
5. Document notifications, CSP and scopes for MCP Toolkit add-ons.
