---
title: "Initial Architecture: Local, Offline Reviewer over Vendored Spec + File-based State"
status: "accepted"
date: "2026-08-11"
decision_makers: ["TBD"]
category: "architecture"
nist_controls: ["CM-2", "SC-7", "AC-3"]
impact_level: "low"
ato_relevance: "yes-internal"
risk_treatment: "n/a"
---

# Initial Architecture: Local, Offline Reviewer over Vendored Spec + File-based State

## Context and Problem Statement

We need a tool to map NIST SP 800-63 normative requirements against the
identity-idp (login.gov) codebase and track per-requirement compliance. The tool
handles compliance findings about a production identity system (CUI-adjacent) and
must be reproducible and auditable. The core question is how to structure a tool
that is trustworthy, reviewable, and does not itself become an attack surface or a
source of unverifiable claims.

## Decision Drivers

- Findings must be reproducible and diffable (git review, not a black-box DB).
- The tool must work offline and never expose identity-idp source to the network.
- Reading identity-idp must be strictly read-only and bounded (no traversal).
- Provenance of every claim must be explicit and survive in the data.

## Considered Options

1. **Local Vite/React UI + Express API over file-based state**, spec vendored at
   ingest, identity-idp read via a `safePath` guard.
2. **Database-backed web app** (Postgres) with a hosted deployment.
3. **Static site generated from the spec** with no interactive assessment layer.

## Decision Outcome

Chosen option: **Option 1 — local reviewer over file-based state**, because it
maximizes reproducibility (deterministic ingest, git-tracked YAML), minimizes
attack surface (localhost-only, read-only `IDP_ROOT`), and keeps provenance
first-class in the data.

- **UI:** React 18 + Vite 6 (dev server on :5180), three panes (spec nav, spec
  text with highlighted requirements, requirement detail).
- **API:** Express 4 on :3001, bound to `127.0.0.1` only, read-only over spec,
  requirement/assessment YAML, and identity-idp files via `server/lib/safePath.ts`.
- **Spec:** vendored HTML fetched once and committed; `scripts/ingest-spec.ts`
  parses it deterministically into a section tree + extracted requirements.
- **State:** version-controlled YAML on disk, hot-reloaded on mtime change.
- **Validation:** `npm run check` validates schema, `IDP_ROOT` path existence,
  line bounds, and snippet drift.

### Positive Consequences

- Fully offline; no runtime network or AI dependency.
- Every finding is a diffable file with explicit provenance.
- `safePath` + localhost binding keep the tool from becoming an exfiltration path.

### Negative Consequences

- File-based state does not scale to many concurrent editors (acceptable: single-operator tool).
- Deterministic parsing means parser limitations surface as data quirks (mitigated by the agentic layers and human review — see ADR-0002).

### Compliance Consequences

- **SC-7 (boundary protection):** localhost-only binding; `IDP_ROOT` read-only boundary via `safePath`.
- **CM-2 (baseline config):** vendored spec + deterministic ingest give a reproducible baseline.
- **AC-3 (access enforcement):** file access mediated by `safePath`.

## Links

- `PROJECT_PLAN.md`
- ADR-0002 (agentic layers), ADR-0003 (multi-revision data model)
