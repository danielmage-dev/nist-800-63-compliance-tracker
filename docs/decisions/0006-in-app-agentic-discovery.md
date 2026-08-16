---
title: "In-App Agentic Discovery: Runtime App Triggers Headless OpenCode Agent"
status: "accepted"
date: "2026-08-13"
decision_makers: ["TBD"]
category: "ai-integration"
nist_controls: ["SC-7", "SC-8", "SI-10", "AC-6", "AU-2", "SA-11", "CM-7"]
impact_level: "low"
ato_relevance: "yes-boundary"
risk_treatment: "mitigate"
supersedes: "0005-agentic-code-retrieval.md"
---

# In-App Agentic Discovery: Runtime App Triggers Headless OpenCode Agent

## Context and Problem Statement

Layer B code discovery was first implemented as a homegrown ReAct loop (ADR-0005;
files since removed) that gave the model only a crippled toolset (fixed-string
search, no directory listing, small budgets). Testing showed the model's
*reasoning* is strong but its *retrieval* is starved: it cites incidental files
instead of the primary implementation, because it cannot browse the repo the way
a full coding agent can. The full OpenCode agent — the same runtime used to
develop this project — already has a rich read-only toolset and consistently
finds the right code.

We want an operator, working entirely in the tracker UI, to click **"Find
supporting code"** on a requirement and have a full-quality agent investigate the
identity-idp codebase and propose a mapping — the "Copilot Autofix / Dependabot"
interaction (request → background job → reviewable proposal). This requires the
tracker's runtime app to trigger an agent that calls USAi, which reverses the
ADR-0001/0002 decision that the reviewer app contains no AI and makes no network
calls.

## Decision Drivers

- Match the investigation quality of a full coding agent (the project's origin).
- Keep the interaction inside the tracker UI (fire-and-forget button + review).
- Preserve the provenance invariant: agent output is an unverified proposal.
- Preserve a defensible, bounded egress posture for CUI-adjacent source.
- Avoid maintaining a second-rate reimplementation of an agent runtime.

## Considered Options

1. **Button runs the homegrown loop** (A1). Easiest wiring, but bottles up the
   exact weak retrieval we are trying to fix. Rejected as the primary path.
2. **Button triggers the real OpenCode agent headless** (A2). The tracker's
   Express API spawns `opencode run` in the sandbox with a task prompt; the agent
   uses its full native read-only tools to investigate identity-idp and returns a
   structured proposal, which the tracker writes through its provenance-locked
   path. Chosen.
3. **MCP / conversational session drives the tracker** (Option B). Highest
   quality and lowest code, but the authoring happens in a chat, not behind a UI
   button. Deferred; not the interaction the operator wants here.

## Decision Outcome

Chosen option: **Option A2 — the runtime app triggers a headless OpenCode agent.**

**Interaction.** In the requirement detail pane, a "Find supporting code" button
starts an async discovery job. The UI polls for status and, on completion, shows
the proposal in the pane and the "awaiting review" queue as
`seededBy: claude, verified: false`. The human reviews and verifies.

**Mechanism.**
- `POST /api/rev/:rev/requirements/:reqId/discover` starts a background job
  (in-memory job registry keyed by `rev:reqId`); `GET .../discover/status`
  returns `queued|running|done|error` for polling.
- The job spawns `opencode run --format json --model usai/claude_4_8_opus
  --dir <IDP_ROOT> "<task prompt>"`. Running with `--dir IDP_ROOT` gives the
  agent its native read-only tools scoped to the identity-idp checkout.
- The task prompt supplies the requirement text and instructs the agent to return
  a single JSON object `{status, notes, refs:[{path,startLine,endLine,snippet,note}]}`.
  The tracker parses the JSON from the agent's final message.
- The result is written through the EXISTING provenance-locked write path
  (`putAssessment` style): stamped `seededBy: claude, verified: false`, and
  refused if the target is `verified: true` or `seededBy: human`.

**This reverses ADR-0001/0002's "no AI in the runtime app."** The reviewer app
now, on explicit operator action, triggers an agent that reaches USAi. It remains
localhost-bound and still performs no model inference *itself* — it shells to the
OpenCode agent, which is the component that calls USAi.

**Egress guardrails re-home to the sandbox + OpenCode layer.** The bounded/
denylisted/audited tool loop from ADR-0005 was enforced in our TypeScript. With
the real OpenCode agent doing the reading, the boundary is enforced by:
- the sandbox egress allowlist (USAi + NIST only; `nist-tracker-egress` kit),
- OpenCode's own permission ruleset and read-only operation for discovery,
- running the agent with `--dir IDP_ROOT` so its file tools are scoped there,
- OpenCode's session/transcript as the audit record of what it read.
The homegrown `layer:discover` path (ADR-0005) has been **removed** — its
retrieval quality was inadequate and maintaining a second, weaker agent added no
value. `layer:map` (operator-supplied candidate files) and `layer:extract`
(Layer A extraction verification) remain as separate CLI capabilities.

### Positive Consequences

- Full-quality investigation behind a single UI button (the project's goal).
- Deletes reliance on the weaker homegrown loop for the primary path.
- Provenance invariant preserved by the tracker's write layer.

### Negative Consequences

- **Runtime app now triggers USAi calls** (reverses ADR-0001/0002). The tracker is
  only fully functional inside the sandbox where OpenCode + the egress kit exist.
- Egress is now agent-selected via OpenCode's tools; the fine-grained per-run
  audit log and denylist we built in ADR-0005 are replaced by sandbox-level
  controls + OpenCode's transcript (coarser). Recorded as a risk-posture change.
- Depends on the `opencode` CLI being present on the host/sandbox PATH.
- Discovery latency (~30–90s) requires an async job + polling UX.

### Compliance Consequences

- **SC-7 / SC-8:** egress remains confined to USAi (+NIST) via the sandbox
  allowlist; the agent runs `--dir IDP_ROOT`.
- **AC-6 / CM-7:** discovery uses a read-only agent invocation; the tracker's
  write path stays the only mutation, provenance-locked.
- **SI-10:** the agent's JSON output is schema-validated before write; `npm run
  check` re-validates cited snippets resolve.
- **AU-2 / SA-11:** proposals attributable (`seededBy: claude`); human-gated
  verification; OpenCode session transcript is the investigation record.
- Update `docs/risk-assessment.md`: note runtime-triggered agentic egress and the
  shift of egress controls to the sandbox/OpenCode layer (T2), and that the
  runtime app is no longer AI-free (revises the T-cluster context).

## Links

- ADR-0001 (no AI at runtime — reversed here), ADR-0002 (agentic layers via USAi),
  ADR-0005 (homegrown bounded loop — superseded and removed), `AGENTS.md`
- `opencode run` (headless agent invocation), `nist-tracker-egress` sbx kit
- `docs/risk-assessment.md` (T2 egress)
