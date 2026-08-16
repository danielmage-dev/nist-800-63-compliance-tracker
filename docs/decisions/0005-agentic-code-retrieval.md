---
title: "Agentic Code Retrieval for Layer B (Bounded, Audited, Read-Only Tool Loop)"
status: "superseded"
date: "2026-08-13"
decision_makers: ["TBD"]
category: "ai-integration"
nist_controls: ["SC-7", "SC-8", "SI-10", "AC-6", "AU-2", "AU-3", "SA-11", "CM-7"]
impact_level: "low"
ato_relevance: "yes-boundary"
risk_treatment: "mitigate"
superseded_by: "0006-in-app-agentic-discovery.md"
---

# Agentic Code Retrieval for Layer B (Bounded, Audited, Read-Only Tool Loop)

> **Superseded by [ADR-0006](0006-in-app-agentic-discovery.md).** This ADR proposed
> a homegrown, bounded ReAct loop (`scripts/layer-discover.ts`,
> `scripts/lib/react-loop.ts`, `scripts/lib/idp-tools.ts`) that gave the model a
> deliberately crippled toolset (fixed-string search, no directory listing, small
> budgets). In testing its *reasoning* was sound but its *retrieval* was starved:
> it cited incidental files instead of the primary implementation, because it
> could not browse the repo the way a full coding agent can. We replaced it with
> the full OpenCode agent invoked headlessly behind the "Find supporting code"
> button (ADR-0006), which consistently produces correct, well-cited findings. The
> three implementation files were removed on 2026-08-15. This ADR is retained for
> decision history; the bounded-loop design is no longer in the codebase.

## Context and Problem Statement

ADR-0002 defined Layer B (mapping verification) as: the operator hands the model
a fixed set of candidate identity-idp files per requirement, and the model judges
whether they implement the control. In practice this gives poor coverage — the
tool is only useful if a human already knows the mapping, which defeats its
purpose. Only requirements explicitly listed (with hand-picked files) in a
candidates file get mapped; the other ~290 requirements are never processed.

The desired functionality is for the model to do the heavy lifting: search and
read the identity-idp repository itself to discover which code implements a
requirement, across all requirements, without a human pre-authoring candidates.
This upgrades Layer B from "grade what I hand you" to "explore the codebase and
propose mappings" — a materially larger capability that changes the egress and
threat posture, so it warrants its own decision.

## Decision Drivers

- Coverage: map many/most requirements without hand-authored candidate lists.
- Preserve the provenance invariant: AI output remains an unverified proposal.
- Preserve deliberate, defensible egress of CUI-adjacent source to USAi.
- Bound cost, time, and runaway-loop risk on a large production codebase.
- Preserve auditability: know exactly which files were read/sent per run.
- Preserve reproducibility expectations honestly (agentic search is not deterministic).

## Considered Options

1. **Bounded, audited, read-only tool loop.** Give the model two read-only tools —
   `search_code` (ripgrep in `IDP_ROOT`) and `read_file` (via `safePath`) — with
   hard per-requirement budgets, a sensitive-path denylist, and a full audit log
   of every tool call. The model discovers candidates and judges the mapping in
   one loop. Output unchanged: `seededBy: claude, verified: false`, human-locked.
2. **Hand-authored candidates only** (status quo from ADR-0002). Rejected: does
   not meet the coverage goal; the manual mapping is the work we want automated.
3. **Pre-pass keyword retrieval, then fixed-file judging.** A script greps for
   candidates, then the existing fixed-file Layer B judges them. Rejected as the
   primary design: still a heuristic pre-pass the model can't refine, and misses
   code that doesn't match surface keywords; kept conceptually as the fallback if
   the loop proves too costly.
4. **Unbounded agent with full tool access (grep/read/execute).** Rejected:
   uncontrolled egress, cost, loop risk, and execution surface; incompatible with
   the least-privilege, deliberate-egress posture.

## Decision Outcome

Chosen option: **Option 1 — a bounded, audited, read-only tool loop.**

**Tools exposed to the model (read-only, no write/execute):**
- `search_code(query, maxResults)` — runs ripgrep within `IDP_ROOT`, returns
  matching `path:line` hits with short context. No arbitrary shell.
- `read_file(path, startLine, endLine)` — reads a slice of an `IDP_ROOT` file via
  `server/lib/safePath.ts` semantics (path must resolve inside `IDP_ROOT`).

**Loop mechanism — ReAct over plain chat (not native tool-calling).** The USAi
gateway's Chat Completions API does not expose a `tools`/`functions` parameter and
its documented feature limitations explicitly exclude "Structured output," so
native OpenAI-style tool-calling is unavailable. Instead we drive a ReAct-style
text protocol: the model emits exactly one JSON action per turn
(`search_code` / `read_file` / `answer`); we execute the read-only tool and feed
the result back as the next message. This is gateway-agnostic and works on the
plain-chat API we have confirmed. USAi's documented rate limit (3 chat calls/sec/key)
is handled client-side with a ≥350 ms inter-call throttle and exponential backoff
on HTTP 429; because Anthropic/Meta/Google models on the gateway carry no provider
guardrails, the "repo content is data, not instructions" system prompt is the sole
injection defense and is written accordingly.

**Guardrails:**
- **Read boundary.** Every read is mediated by `safePath` (inside `IDP_ROOT`,
  read-only). The model has no write or execute capability.
- **Denylist.** The tools MUST refuse to read/return any path that identity-idp's
  own `.gitignore` excludes (parsed from `IDP_ROOT/.gitignore`), plus a built-in
  hard denylist of sensitive patterns (`.env*`, `*.key`, `*.pem`, `*.p12`,
  `*_secret*`, `.databag_secret`, `config/secrets*`, credentials/keystores). A
  gitignored or denylisted path is never searched, read, returned, or sent to
  USAi.
- **Budgets (conservative defaults, per requirement):** ≤6 `search_code` calls,
  ≤12 `read_file` calls, and a per-requirement wall-clock timeout. On budget
  exhaustion the model is forced to conclude with its best current answer (or
  `not-assessed` if it has none). A global run timeout also applies.
- **Scope.** Runs per **chapter** or per **single requirement** (`--req`), never
  implicitly across all 292 at once. Resumable: honors the human-lock and can skip
  already-proposed records.
- **Efficiency.** File reads are cached within a run; duplicate searches are
  short-circuited; the loop stops early once the model has cited sufficient
  evidence.
- **Audit log.** Every tool call (tool, query/path, line range, result size) is
  written to a per-run log under `data/reviews/<rev>-layerB-audit-*.jsonl`. This
  is the authoritative record of what source egressed to USAi.
- **Prompt-injection defense.** System prompt frames all repo content as data,
  not instructions; because the model's only tools are read-only search/read, it
  cannot act on injected instructions even if present.
- **Provenance unchanged.** Results are written `seededBy: claude, verified: false`
  and refuse to overwrite any `verified: true` / `seededBy: human` record. Model
  must cite exact `path` + line range + verbatim `snippet`; `npm run check`
  re-validates that snippets resolve, catching fabricated citations.

### Positive Consequences

- Broad coverage without hand-authored candidate lists — the intended capability.
- Compliance posture preserved by construction: read-only, boundaried, denylisted,
  budgeted, audited, and human-verified.
- The per-run audit log makes source egress reviewable after the fact.

### Negative Consequences

- **Egress posture shifts** from operator-selected files (ADR-0002) to
  agent-selected files within a read-only, denylisted, audited boundary. This is a
  deliberate expansion of risk T2, accepted for an internal pre-ATO tool and
  recorded here.
- Higher USAi cost and longer runtime than fixed-file judging (mitigated by
  per-chapter scope and budgets).
- Non-deterministic: re-runs may propose different mappings (acceptable —
  proposals, not findings; the deterministic parser remains the requirement
  baseline).
- Larger prompt-injection surface (mitigated: read-only tools, data-not-commands
  framing).
- More proposals to review raises human-over-trust risk T10 (mitigated by the
  review queue and verify-before-cite discipline).

### Compliance Consequences

- **SC-7 / SC-8:** egress remains confined to the GSA USAi gateway over TLS;
  reads confined to `IDP_ROOT`.
- **AC-6 / CM-7:** least privilege — the agent has exactly two read-only tools; no
  write/execute; explicit denylist of sensitive paths and gitignored files.
- **SI-10:** model output schema-validated; citations re-validated by `check`.
- **AU-2 / AU-3:** per-run audit log records every tool call (what was read/sent).
- **SA-11:** AI output attributable (`seededBy: claude`) and human-gated.
- Update `docs/risk-assessment.md`: revise T2 (source egress now agent-selected,
  bounded/audited/denylisted) and note the new audit-log control.

## Links

- ADR-0002 (Layer B fixed-file design this extends), ADR-0003 (multi-rev), `AGENTS.md`
- `server/lib/safePath.ts` (read boundary reused by the tools)
- `scripts/check-assessments.ts` (snippet re-validation)
- `docs/risk-assessment.md` (T1 prompt injection, T2 egress, T10 over-trust)
