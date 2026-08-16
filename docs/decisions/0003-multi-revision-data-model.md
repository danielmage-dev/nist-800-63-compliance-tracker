---
title: "Multi-Revision Data Model: rev as a First-Class Dimension"
status: "accepted"
date: "2026-08-11"
decision_makers: ["TBD"]
category: "data-model"
nist_controls: ["CM-2", "CM-3"]
impact_level: "low"
ato_relevance: "yes-internal"
risk_treatment: "n/a"
---

# Multi-Revision Data Model: rev as a First-Class Dimension

## Context and Problem Statement

NIST publishes SP 800-63 in revisions (rev 3, rev 4, future revs/drafts). In the
real world, certification efforts against different revisions run **concurrently
and at different stages of completion** — e.g. a rev-3 certification finishing
while a rev-4 assessment is early and a rev-5 draft is monitored. The initial
implementation assumed a single implicit revision: IDs like `3.1.1.2-R21` are not
rev-qualified, `data/spec/{spec,requirements}.json` are single files, and
`chapterOf()` strips any revision. This cannot represent multiple revisions at once.

## Decision Drivers

- Multiple revisions' assessments must coexist and progress independently.
- Adding a future revision must not disturb or re-key existing revisions.
- Requirement IDs must not collide across revisions.
- Cross-revision reconciliation (carry-forward of verified findings) must be possible.
- Keep the file-based, git-diffable model from ADR-0001.

## Considered Options

1. **Partition all data per revision on disk; add a `rev` field to every record;**
   keep short IDs scoped within a revision; add a `data/revisions.json` registry.
2. **Rev-prefixed global IDs** (e.g. `r4:3.1.1.2-R21`) with flat storage — more
   string-parsing churn across every script; IDs less readable.
3. **Single "active" revision, swap in place** — cannot represent concurrent revisions.

## Decision Outcome

Chosen option: **Option 1 — per-revision partitioning + `rev` field + registry**,
because it lets revisions coexist cleanly, is additive (a new rev is a new sibling
directory), keeps IDs readable, and minimizes parsing churn compared with global
rev-prefixed IDs.

**Directory layout:**

```
data/
  revisions.json                 # registry of revisions
  spec/
    800-63b-r3/{raw/,spec.json,requirements/*.yaml,assets/}
    800-63b-r4/{raw/,spec.json,requirements/*.yaml,assets/}
  assessments/
    800-63b-r3/*.yaml
    800-63b-r4/*.yaml
```

**Keys and records:**
- Requirement short ID stays `{section}-R{ordinal}`, unique *within a revision*.
- Every requirement and assessment record carries a `rev` field (e.g. `"800-63b-r4"`).
- `textHash` (already present) is the cross-revision reconciliation key (see ADR-0004).

**Registry (`data/revisions.json`):** array of
`{ doc, rev, status: draft|final|superseded|active, sourceUrl, ingestedAt }`.

**Consequential code changes (mechanical, tracked as implementation work):**
`src/types.ts` (+`rev`), the four scripts (rev-aware paths + `chapterOf`), the three
server routes (rev in the path), the API client, and a revision selector in the UI.
`npm run check` runs per revision. Requirements also move from a single JSON file to
per-chapter YAML (mirroring assessments) so requirement edits are diffable — this
supersedes the `requirements.json` layout from ADR-0001.

### Positive Consequences

- Concurrent, independent per-revision assessments — the core requirement.
- Adding a revision is additive; existing revisions are untouched.
- Cross-rev migration becomes possible because revisions coexist in the store.

### Negative Consequences

- One-time refactor across types, scripts, server, and UI.
- More files on disk (per-revision trees).

### Compliance Consequences

- **CM-2 / CM-3 (baseline / change control):** each revision is an independently
  version-controlled, reproducible baseline with recorded provenance and source URL.

## Links

- `PROJECT_PLAN.md`, ADR-0001 (baseline; requirements.json superseded here), ADR-0004 (revision detection + migration)
