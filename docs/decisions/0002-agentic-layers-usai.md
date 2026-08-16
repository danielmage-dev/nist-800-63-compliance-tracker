---
title: "Two Agentic Layers via the GSA USAi Gateway with Human-Verified Provenance"
status: "accepted"
date: "2026-08-11"
decision_makers: ["TBD"]
category: "ai-integration"
nist_controls: ["SC-7", "SC-8", "SI-10", "AC-6", "AU-2", "SA-11"]
impact_level: "low"
ato_relevance: "yes-boundary"
risk_treatment: "mitigate"
supersedes: ""
---

# Two Agentic Layers via the GSA USAi Gateway with Human-Verified Provenance

## Context and Problem Statement

The deterministic parser (ADR-0001) extracts requirements mechanically and cannot
judge whether a requirement was mis-extracted, nor which identity-idp source
implements a control. We want to add AI assistance for (A) verifying requirement
extraction and (B) proposing requirement-to-code mappings — without undermining
the tool's core value: that a "finding" is something a human confirmed. This
introduces an LLM and, for Layer B, egress of identity-idp source snippets — which
changes the tool's network and data-flow posture.

## Decision Drivers

- The tool's entire credibility rests on separating AI *proposals* from human
  *findings*; AI must never manufacture a verified finding.
- Source-code egress is CUI-adjacent and must stay within a FedRAMP-relevant boundary.
- Prompt injection: spec text and identity-idp source are untrusted model input.
- Reuse existing, already-authorized infrastructure rather than introduce a new vendor.

## Considered Options

1. **Two authoring-time scripts calling the GSA USAi gateway**, writing directly
   into on-disk YAML but only as `seededBy: claude, verified: false`, with a hard
   refusal to overwrite `verified: true` / `seededBy: human` records.
2. **Direct hosted LLM API** (e.g. Anthropic/OpenAI) — introduces a new vendor,
   new credential, and egress outside the GSA boundary.
3. **Local model only** (e.g. Ollama) — preserves air-gap but sacrifices quality
   and adds heavy setup for a single-operator tool.
4. **Embed AI in the runtime app** — rejected outright; collapses the runtime /
   authoring split and puts a model in the always-on local server.

## Decision Outcome

Chosen option: **Option 1 — two opt-in authoring-time scripts calling the GSA USAi
gateway**, because it reuses the same FedRAMP-relevant gateway already configured
in `opencode.jsonc` (`https://api.gsa.usai.gov/api/v1`, `USAI_API_KEY` from env),
keeps all AI out of the runtime app, and preserves the provenance invariant by
construction.

**Layer A — extraction verification.** Reviews a revision's parser output against
the spec text. It may **add** missed requirements (`seededBy: claude, verified: false`)
and **flag** suspected false positives / wrong keyword level for human resolution.
It MUST NOT delete parser entries; the deterministic parser remains the reproducible
baseline (`requirements` stay authoritative until a human acts on a flag).

**Layer B — mapping verification.** For a requirement plus candidate identity-idp
source (read via `safePath`), it judges whether the code implements the control and
proposes `status`, `notes`, and file `refs`, written as
`seededBy: claude, verified: false`.

**Shared guardrails (both layers):**
- All model calls go ONLY to the GSA USAi gateway; `USAI_API_KEY` from env, never hardcoded.
- Writes are always `verified: false`, `seededBy: claude`.
- Both refuse to overwrite any `verified: true` or `seededBy: human` record — the
  same lock enforced in `scripts/apply-seed.ts`.
- Model output is schema-validated before being written to disk.
- Spec/source content is treated as data, not instructions (prompt-injection defense).
- Scripts are opt-in and operator-invoked; running them requires user approval per AGENTS.md.

Humans review AI-seeded records in the UI and mark them `verified: true` (edits
stamp `seededBy: human`).

### Positive Consequences

- No new AI vendor or credential; egress confined to the GSA USAi gateway.
- Runtime app stays offline and AI-free.
- Provenance invariant holds by construction; AI can never produce a finding.

### Negative Consequences

- Layer B sends identity-idp source snippets off the machine (to USAi) — a real
  change to the data-flow posture; mitigated by boundary confinement and opt-in gating.
- Model output quality varies; human review remains mandatory (accepted).
- Prompt-injection risk from untrusted spec/source content (mitigated; see risk assessment T1/T8).

### Compliance Consequences

- **SC-7 / SC-8 (boundary / transmission):** egress confined to the GSA USAi gateway over TLS.
- **SI-10 (input validation):** model output schema-validated at the boundary.
- **AC-6 (least privilege):** authoring scripts are separate from the runtime app; `IDP_ROOT` read-only.
- **AU-2 / SA-11 (audit / developer testing):** AI-seeded records are attributable (`seededBy: claude`) and gated by `npm run check` + human review.
- Update the risk assessment for source egress, prompt injection, and over-trust of AI output.

## Links

- `PROJECT_PLAN.md`, ADR-0001 (baseline architecture), ADR-0003 (multi-revision data model)
- `opencode.jsonc` (USAi provider configuration)
- `scripts/apply-seed.ts` (existing overwrite-refusal lock this reuses)
