---
title: "Revision Detection via NIST CSRC (Report-Only) and Cross-Revision Migration"
status: "accepted"
date: "2026-08-11"
decision_makers: ["TBD"]
category: "integration"
nist_controls: ["SC-7", "SI-10", "CM-3", "SR-3"]
impact_level: "low"
ato_relevance: "yes-boundary"
risk_treatment: "mitigate"
---

# Revision Detection via NIST CSRC (Report-Only) and Cross-Revision Migration

## Context and Problem Statement

SP 800-63 documents are updated over time; a tool pinned to one revision silently
goes stale. We want to (1) detect when NIST publishes a newer revision or draft
and (2) migrate human-verified findings forward when we adopt a new revision —
without silently swapping the spec out from under existing verified findings.

## Decision Drivers

- Staleness must be surfaced automatically, but adoption must remain a human decision.
- CUI-adjacent findings must never be silently invalidated or auto-overwritten.
- NIST CSRC returns HTTP 403 to bare (non-browser) clients — detection must tolerate this.
- Requirement text changes across revisions; carry-forward must be conservative.

## Considered Options

1. **Report-only detection + human-triggered ingest/migration.** A script queries
   the CSRC publications feed/search (browser-headered, newest-first,
   `status=Final,Draft`), records findings in `data/revisions.json`, and stops
   there. Migration is a separate, explicit, human-run step.
2. **Auto-fetch and auto-ingest** newer revisions — rejected: violates the "never
   auto-vendor" rule and risks invalidating verified findings unattended.
3. **No detection; manual monitoring only** — rejected: the staleness problem is
   the motivation for this ADR.

## Decision Outcome

Chosen option: **Option 1 — report-only detection, human-triggered ingest and
migration.**

**Detection.** A script queries the CSRC publications endpoint
(`https://csrc.nist.gov/publications/search?keywords-lg=800-63&sortBy-lg=releasedate+DESC&status-lg=Final,Draft&series-lg=SP&...`)
with a browser `User-Agent` (CSRC 403s bare clients). Prefer a structured feed
(RSS/JSON) where available; fall back to parsing the HTML results. It compares the
newest published revision/draft against `data/revisions.json` and records any new
finding (with its `sourceUrl` and `status`). It NEVER vendors, ingests, or swaps a
spec. Output is a report; a human decides whether to adopt.

**Ingest** of an adopted revision is the existing (parameterized) deterministic
ingest, run explicitly by a human (requires approval per AGENTS.md).

**Cross-revision migration.** When adopting rev N+1, a migration step matches
rev-N requirements to rev-N+1 by `textHash`:
- **Exact `textHash` match** → carry the rev-N assessment forward as a rev-N+1
  proposal, but as `seededBy: claude/parser, verified: false` (re-review required;
  a human re-confirms in the new revision). Verified status does NOT transfer
  automatically.
- **Text changed / no match** → flag as "needs re-review" (new or reworded requirement).
- **Removed** → surfaced so its mappings are not silently lost.
- **(Optional) agentic semantic reconciliation** (Layer A style, via USAi) may
  propose matches for reworded requirements `textHash` cannot align — as unverified
  proposals only.

Migration never sets `verified: true` and never overwrites a `verified: true` /
`seededBy: human` record in the target revision.

### Positive Consequences

- Staleness is surfaced automatically; the tool can track drafts before they finalize.
- Verified findings are never silently invalidated or auto-migrated.
- Multi-revision store (ADR-0003) makes carry-forward feasible.

### Negative Consequences

- CSRC HTML/feed structure can change, breaking parsing (mitigated: prefer feed, degrade gracefully, report-only).
- Migration produces re-review work each adoption (accepted; it is the point).

### Compliance Consequences

- **SC-7 (boundary):** outbound to CSRC only, read-only, browser-headered.
- **SI-10 (input validation):** CSRC responses parsed defensively; treated as untrusted.
- **CM-3 (change control):** revision adoption is an explicit, human-gated change with recorded provenance.
- **SR-3 (supply chain):** vendored spec provenance (source URL, ingest date) recorded in the registry.

## Links

- `PROJECT_PLAN.md`, ADR-0003 (multi-revision data model), ADR-0002 (agentic layers — optional semantic reconciliation)
- CSRC search: <https://csrc.nist.gov/publications/search?keywords-lg=800-63&sortBy-lg=releasedate+DESC&viewMode-lg=brief&ipp-lg=all&status-lg=Final,Draft&series-lg=SP&topicsMatch-lg=ANY&controlsMatch-lg=ANY>
