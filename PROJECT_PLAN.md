---
title: "Project Plan"
description: "Starting point for a new federal coding project — fill this out and let the AI agent set up everything else"
status: canonical
tier: 3
load_priority: reference-only
audience: ["developers", "tech-leads", "managers"]
---

# Project Plan

> **Instructions:** Fill out each section below. Your AI coding agent will use this to automatically set up the repository, generate compliance documentation, and create the initial project structure. Be specific — the more detail you provide, the better the agent can help.

## Project Identity

| Field | Value |
|---|---|
| **Project Name** | NIST 800-63B Compliance Tracker |
| **Repository Name** | NIST-800-63-tracker |
| **Organization/Agency** | GSA/TTS (login.gov / Identity) |
| **Project Owner** | TBD |
| **Start Date** | 2026-08-11 |
| **Target Completion** | Ongoing |

## Business Objective

A local, single-operator auditing tool that maps the normative requirements of the NIST SP 800-63 family (SHALL / SHOULD / MAY) against the identity-idp (login.gov) codebase, tracking per-requirement compliance status, notes, and the specific source files that implement each control. It exists to make an otherwise manual, error-prone compliance review reproducible, reviewable, and traceable.

The tool is **multi-revision by design**: NIST publishes the 800-63 documents in revisions (rev 3, rev 4, and future revs/drafts), and real-world certification efforts run against different revisions concurrently and at different stages of completion. The tool therefore holds multiple revisions in its store simultaneously, each with its own independent set of requirements and assessments, so (for example) a rev-3 certification can be finishing while a rev-4 assessment is early and a rev-5 draft is being monitored. `rev` is a first-class dimension of the data model. A revision registry tracks which revisions exist, their status (`draft` | `final` | `superseded` | `active`), source URL, and ingest date, and a rev-detection feature reports when NIST publishes a newer revision or draft.

The tool is built around a single provenance model applied uniformly to **both** the extracted requirements and the compliance assessments: every record carries `seededBy` (`parser` | `claude` | `human`) and `verified` (`true`/`false`), where **`verified: true` always means a human checked it**. Two AI ("agentic") layers, invoked at authoring time against the GSA USAi gateway, populate records as unverified proposals; a human then reviews and marks them `verified: true`:

- **Layer A — Extraction verification.** Reviews the deterministic parser's requirement extraction against the spec text, proposes *additional* missed requirements (`seededBy: claude, verified: false`) and *flags* suspected false positives / wrong keyword level for human resolution. It never deletes parser entries.
- **Layer B — Mapping verification.** For a requirement and candidate identity-idp source, judges whether the code implements the control and writes a proposed status / notes / file mappings (`seededBy: claude, verified: false`).

In both layers the AI populates data; the human verifies. AI-seeded records are never treated as findings until a human clears them, and AI writes can never overwrite a `verified: true` or `seededBy: human` record.

## Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript 5.7 | End-to-end type safety across the React UI, Express API, and ingest/seed scripts; single language for the whole tool. |
| **Framework** | React 18 + Vite 6 (UI), Express 4 (local API) | Vite for a fast dev UI; a thin Express API to read spec/assessment/source files off disk. No heavy framework needed for a local tool. |
| **Database** | None (YAML + JSON files on disk, partitioned per revision) | Assessments and requirements are version-controlled YAML so changes are diffable and reviewable in git; a database would obscure provenance and add operational surface for zero benefit. Revisions are partitioned into separate directories so multiple revs coexist. |
| **AI / LLM** | GSA USAi LiteLLM gateway (`https://api.gsa.usai.gov/api/v1`, `USAI_API_KEY`) | The two authoring-time agentic layers call USAi — the FedRAMP-relevant GSA gateway — via its OpenAI-compatible API. Reuses the credential and provider already configured in `opencode.jsonc`; no additional AI vendor or key is introduced. |
| **Cloud/Hosting** | None — runs locally, binds to 127.0.0.1 only | The tool reads a local identity-idp checkout off disk and must never be exposed to the network. |
| **CI/CD** | GitHub Actions | Repo is hosted on GitHub; Actions runs typecheck and `npm run check` (assessment validation) on PRs. |
| **Container Runtime** | None | Not needed for a local Node tool; `npm install && npm run dev` is the full setup. |

## Compliance Level

<!-- Check ONE: -->

- [x] **FIPS Low** — Public-facing informational content, no PII, no CUI
- [ ] **FIPS Moderate** — Most federal systems: PII, financial data, internal tools
- [ ] **FIPS High** — National security systems, critical infrastructure

> The tool itself processes no PII and has no runtime AI or network calls. It is a
> local developer utility. See Data Classification below for the one nuance about
> its *outputs*.

## Data Classification

<!-- Check all that apply: -->

- [x] Public data only
- [ ] PII (Personally Identifiable Information)
- [x] CUI (Controlled Unclassified Information)
- [ ] PHI (Protected Health Information)
- [ ] Financial data (FTI, payment info)
- [ ] Authentication credentials/secrets

> **Public data:** The vendored NIST SP 800-63B spec is a U.S. Government work in
> the public domain. **CUI:** The compliance assessments — which requirements
> identity-idp does/does not satisfy, and the mapped file locations — are security-
> relevant findings about a production identity system and should be handled as CUI.
> Do not publish `verified: true` gap findings without appropriate review.
>
> **AI egress:** Layer B sends identity-idp *source snippets* to the GSA USAi
> gateway to judge mappings, and Layer A sends spec text. This egress is confined
> to the FedRAMP-relevant GSA USAi gateway, is opt-in and operator-invoked, and is
> documented in ADR-002 and the risk assessment.

## Key Requirements

<!-- List the 3-5 most important functional requirements. These help the agent understand what to build. -->

1. Multi-revision data model: `rev` is a first-class dimension. Spec, requirements, and assessments are partitioned per revision on disk (e.g. `data/spec/800-63b-r4/…`, `data/assessments/800-63b-r4/…`), so multiple revisions' assessments coexist and progress independently. A `data/revisions.json` registry records each revision's document, rev number, status (`draft`|`final`|`superseded`|`active`), source URL, and ingest date. Requirement IDs are scoped within a revision (short ID `{section}-R{ordinal}` plus a `rev` field on each record), and `textHash` supports cross-rev reconciliation.
2. Deterministically ingest a given revision's vendored HTML into a stable section tree and extracted normative requirements. Ingest is parameterized by revision so any rev can be vendored without disturbing existing revs; re-parsing stays deterministic. Parser-produced requirements are stamped `seededBy: parser, verified: false`.
3. Apply one uniform provenance model to **both** requirements and assessments: every record carries `seededBy` (`parser` | `claude` | `human`) and `verified` (bool). `verified: true` always means a human confirmed the record. Requirements are stored as version-controlled per-chapter YAML (mirroring assessments) so requirement edits are diffable and reviewable in git.
4. Layer A (extraction verification) — an authoring-time script calls the USAi gateway to review a revision's parser output against the spec, proposes missed requirements (`seededBy: claude, verified: false`) and flags suspected false positives / wrong level for human resolution. It never deletes parser entries; the deterministic parser remains the reproducible baseline.
5. Layer B (mapping verification) — an authoring-time script calls the USAi gateway to judge whether identity-idp source implements a requirement (within a revision) and writes proposed status / notes / file mappings as `seededBy: claude, verified: false`. Both layers refuse to overwrite any `verified: true` or `seededBy: human` record.
6. Revision detection — a report-only script queries the NIST CSRC publications search/feed (sorted newest-first, `status=Final,Draft`) to detect when a newer 800-63 revision or draft exists, and records it in the revision registry with its source URL. It never auto-vendors or swaps a spec; a human triggers ingest and any cross-rev migration explicitly.
7. Present a three-pane review UI with a **revision selector**: spec navigation, highlighted spec text, and requirement detail, all scoped to the selected revision. Auditors review AI-seeded requirements and assessments, edit them (stamping `seededBy: human`), and mark records `verified: true`; the dashboard surfaces per-revision progress and the "awaiting review" queue.
8. Validate with `npm run check` (per revision): schema conformance for requirements and assessments, mapped-path existence under `IDP_ROOT`, line-range bounds, and snippet drift detection (warn when a mapped snippet no longer appears within ±20 lines of its recorded start line).

## Constraints

<!-- List any hard constraints the project must work within. -->

- [ ] Must use FedRAMP-authorized services only
- [ ] Must support Section 508 accessibility
- [x] Must integrate with existing system: identity-idp (read-only, off a local checkout via `IDP_ROOT`)
- [x] Must support offline/air-gapped operation — **the reviewer app (Vite UI + Express API) runs fully offline**; only the opt-in agentic authoring scripts (Layers A/B) and the revision-detection script require network access (USAi gateway and the NIST CSRC site, respectively).
- [x] Other: **Runtime vs. authoring-time AI split.** The reviewer application makes no model calls and binds to `127.0.0.1` only. The two agentic layers are separate, operator-invoked authoring scripts; they are the only components that call an LLM. All AI traffic goes to the GSA USAi gateway (`https://api.gsa.usai.gov/api/v1`) using `USAI_API_KEY` from the environment — never hardcoded. Spec text (Layer A) and identity-idp source snippets (Layer B) are untrusted input to the model and must be treated as potential prompt-injection vectors (see risk assessment). The revision-detection script makes read-only, browser-headered requests to the NIST CSRC publications search/feed (CSRC returns 403 to bare clients); it is report-only and never auto-vendors a spec.

## Team

| Role | Person | Access Level |
|---|---|---|
| Project Owner | TBD | Admin |
| Lead Developer | TBD | Write |
| Security/ISSO | TBD | Read + Review |
| Approving Official | TBD | Read |

## Agent Environment

<!-- Where will the AI coding agent run? Check all that apply: -->

- [x] **Local machine** — developer's workstation with CLI access
- [ ] **GitHub Codespace** — cloud-hosted dev environment
- [ ] **Sandboxed container** — isolated Docker/Podman environment
- [ ] **CI/CD only** — agent runs in GitHub Actions, no local access

<!-- What services does the agent need access to? Check all that apply: -->

- [x] **GitHub** — push code, create PRs, manage issues
- [ ] **cloud.gov** — deploy applications
- [ ] **workshop.cloud.gov (GitLab)** — alternative code hosting
- [ ] **npm/PyPI** — publish packages
- [ ] **Container registry** — push images
- [x] **GSA USAi gateway** — LLM inference for the two agentic authoring layers (`USAI_API_KEY`)

<!-- The `agent-permissions` skill will configure minimal-scope credentials for each checked service. -->

## Implementation Approach

Build a small, fully local TypeScript tool with two processes started by `npm run dev`: a Vite/React front end (:5180) and an Express API (:3001) bound to localhost only. The Express layer exposes read-only endpoints over the data sources on disk — the vendored spec, the per-chapter requirement and assessment YAMLs, and files read out of a configurable `IDP_ROOT` identity-idp checkout — with a `safePath` guard to prevent path traversal outside `IDP_ROOT`. A deterministic ingest script parses vendored HTML into requirements so IDs are stable and the baseline is reproducible offline.

`rev` is a first-class dimension: spec, requirements, and assessments are partitioned per revision on disk under revision-scoped directories, so multiple revisions coexist and their assessments progress independently. A `data/revisions.json` registry records each revision's status and source URL, and requirement IDs are scoped within a revision (short `{section}-R{ordinal}` ID plus a `rev` field on every record). A report-only revision-detection script queries the NIST CSRC publications feed to flag newer revisions/drafts into the registry; ingest and any cross-rev migration are always human-triggered.

Layered on top are two authoring-time agentic scripts that call the GSA USAi gateway (OpenAI-compatible API, `USAI_API_KEY` from env) via a shared client module. **Layer A** reviews a revision's parser output against the spec and proposes missed requirements / flags suspected errors. **Layer B** judges whether identity-idp source implements a requirement (within a revision) and proposes status, notes, and file mappings. Both write directly into the on-disk YAML but only as unverified proposals: every record they touch is stamped `seededBy: claude, verified: false`, and both refuse to overwrite any `verified: true` or `seededBy: human` record — the same lock the existing `apply-seed` step enforces. Humans review AI-seeded records in the UI and mark them `verified: true` (stamping `seededBy: human` on edit).

State lives entirely in git-tracked YAML — requirements and assessments alike — hot-reloaded on mtime change, with `npm run check` validating schema, path existence, line bounds, and snippet drift. The design's central invariant is a single uniform provenance model: `verified: true` always means a human confirmed the record, keeping AI-authored proposals cleanly separable from human-verified findings across both requirements and assessments.

## What Happens Next

After you fill out this template and place it in your repository:

1. **The AI agent reads this file** and understands your project
2. **It runs the project-bootstrap skill** which:
   - Creates the directory structure appropriate for your stack
   - Generates AGENTS.md (behavioral contract for AI agents)
   - Copies CODING_PRACTICES.md (secure coding standards)
   - Creates ADR-001 from your implementation approach
   - Generates a risk assessment from your compliance level + data classification
   - Sets up CI/CD workflows for your stack
   - Creates SECURITY.md, CONTRIBUTING.md, LICENSE
3. **You review the generated files** and adjust as needed
4. **Start building** — the agent follows the standards automatically

The entire setup takes about 5 minutes of human input and 2 minutes of agent work.
