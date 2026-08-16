# nist-800-63-compliance-tracker

This application ingests the normative requirements from NIST SP 800-63 and tracks
the [identity-idp](../identity-idp) (login.gov) codebase's compliance against them
across multiple revisions. An agentic layer proposes mappings from each requirement
to the supporting code in identity-idp; a human reviews, verifies, and tracks the
compliance status of each requirement.

A three-pane, VS Code-style UI presents the work:

- **Left** — spec section navigation with per-section assessment counts
- **Center** — the spec text, with every normative requirement (SHALL / SHOULD / MAY)
  highlighted, badged with its status, and clickable
- **Right** — the selected requirement: compliance status, notes, and the mapped
  identity-idp files rendered with syntax highlighting and "Open in VS Code" deep links
- **Top** — a revision selector for switching between tracked revisions (e.g. rev 4, rev 3)

## Multiple revisions

NIST publishes 800-63 in revisions. This tool treats `rev` as a first-class
dimension: each revision has its own vendored spec, its own extracted
requirements, and its own assessments, so multiple certification efforts (e.g. a
finishing rev-3 review and an early rev-4 review) can run side by side. A registry
at `data/revisions.json` lists the tracked revisions, their status
(`draft` / `final` / `superseded` / `active`), source URL, and ingest date.

## Setup

```bash
npm install
cp .env.example .env   # then set IDP_ROOT for your machine
```

`.env` points at the identity-idp checkout under audit:

```
IDP_ROOT=/absolute/path/to/identity-idp
```

If unset, it defaults to `../identity-idp`, so a sibling checkout works with no
configuration. The API binds to `127.0.0.1` only — it reads files out of `IDP_ROOT`
and must not be exposed to the network.

## Running

```bash
npm run dev
```

Vite on http://localhost:5180, Express API on :3001. The app opens on the `active`
revision; use the header selector to switch.

## Data

Nothing is stored in a database. All state is committed files, partitioned per
revision under `data/spec/<rev>/` and `data/assessments/<rev>/`:

| Path | What | Edited by |
| --- | --- | --- |
| `data/revisions.json` | Registry of tracked revisions | Ingest / by hand |
| `data/spec/<rev>/raw/*.html` | Vendored copy of the NIST page | Never (re-fetch only) |
| `data/spec/<rev>/spec.json` | Parsed section tree | `npm run ingest` |
| `data/spec/<rev>/requirements/*.yaml` | Extracted requirements, per chapter (`seededBy: parser`) | `npm run ingest` |
| `data/spec/<rev>/assets/` | Vendored images | Never (re-fetch only) |
| `data/assessments/<rev>/*.yaml` | Status, notes, and file mappings, one file per chapter | The UI, seed scripts, or by hand |
| `data/seeds/*.yaml` | Claude-authored mapping proposals | Claude |

The server re-reads the assessment YAMLs whenever their mtime changes, so edits made by a
script or by hand show up without a restart.

The vendored spec content under `data/spec/` is a work of the U.S. Government in the
public domain. It is copied verbatim so that parsing is reproducible and the tool works
offline.

## Scripts

All data-producing scripts take a `--rev <revKey>` argument (default `800-63b-r4`):

```bash
npm run ingest -- --rev 800-63b-r4                          # re-parse the vendored spec HTML for a revision
npm run seed:template -- --rev 800-63b-r4                   # add not-assessed skeletons for every requirement
npm run seed:apply -- --rev 800-63b-r4 data/seeds/<f>.yaml  # merge a Claude-authored seed
npm run check                                               # validate all revisions (schema, paths, line bounds, drift)
npm run check -- --rev 800-63b-r4                           # validate one revision
```

## The provenance contract

Every **requirement** and every **assessment** carries `seededBy`
(`parser` | `claude` | `human`) and `verified` (bool). **`verified: true` always
means a human confirmed it.**

- The deterministic parser writes requirements as `seededBy: parser, verified: false`.
- AI-authored records (the agentic layers, `apply-seed`) are written
  `seededBy: claude, verified: false`.
- AI writes **refuse to overwrite** any entry where `verified: true` or
  `seededBy: human`; those are reported as skipped.
- Editing anything in the UI stamps `seededBy: human`, which permanently protects it
  from later seed/agentic runs.

The dashboard's "awaiting review" queue is the human review worklist.

`npm run check` also warns when a mapping's `snippet` no longer appears within ±20 lines of
its recorded `startLine` — that's how line drift surfaces as identity-idp changes, rather
than mappings silently pointing at the wrong code.

## Provenance and AI involvement

The **reviewer application** contains **no AI at runtime** — no model calls, no
inference — and makes **no network calls**. It is a local Express + React app that
reads YAML and source files off disk and binds to `127.0.0.1`.

AI is confined to opt-in, operator-invoked **authoring-time scripts** that call the
GSA USAi gateway (`https://api.gsa.usai.gov/api/v1`, `USAI_API_KEY` from the
environment):

1. **Layer A — extraction verification.** Reviews the parser's requirement
   extraction against the spec, proposing missed requirements and flagging
   suspected errors (as unverified `seededBy: claude` proposals; never deletes
   parser entries).
2. **Layer B — mapping verification.** Judges whether identity-idp source
   implements a requirement and proposes status / notes / file mappings
   (`seededBy: claude, verified: false`).

A separate report-only **revision-detection** script queries the NIST CSRC
publications feed to flag newer revisions/drafts; it never auto-vendors a spec.

Every mapping and assessment marked `seededBy: claude` is an LLM-authored proposal
— an **assertion, not a finding** — until a human checks the box. Any compliance
claim from this tool should cite `verified: true` entries only.

See `docs/decisions/` (ADR-0001…0004) for the architecture, agentic-layer, and
multi-revision decisions, and `AGENTS.md` for the AI agent behavioral contract.

## Requirement IDs

IDs are `{sectionNumber}-R{ordinal}`, e.g. `3.1.1.2-R21`, unique **within a
revision** (each record also carries its `rev`). Since the raw HTML is vendored,
re-parsing is deterministic and IDs are stable. Each requirement also carries a
`textHash` so IDs can be reconciled across revisions or if the parser changes.

## Known parser notes

- A stem paragraph ending in a colon ("The verifier SHALL:") followed by a list produces one
  requirement per list item, with the stem preserved as `context`.
- Definitional sections (Notations, Glossary, References, Change Log, Abbreviations) are
  excluded from extraction — their ALL-CAPS keywords are definitions, not requirements.
- False positives can be marked `not-applicable` with a note; the parser does not need to be
  perfect for the tool to be useful.
