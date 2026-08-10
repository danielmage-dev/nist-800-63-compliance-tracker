# nist-tracker

A three-pane, VS Code-style UI for auditing [identity-idp](../identity-idp) against
**NIST SP 800-63B rev 4**.

- **Left** — spec section navigation with per-section assessment counts
- **Center** — the spec text, with every normative requirement (SHALL / SHOULD / MAY)
  highlighted, badged with its status, and clickable
- **Right** — the selected requirement: compliance status, notes, and the mapped
  identity-idp files rendered with syntax highlighting and "Open in VS Code" deep links

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

Vite on http://localhost:5180, Express API on :3001.

## Data

Nothing is stored in a database. Two kinds of files, both committed:

| Path | What | Edited by |
| --- | --- | --- |
| `data/spec/raw/sp800-63b.html` | Vendored copy of the NIST page | Never (re-fetch only) |
| `data/spec/spec.json`, `requirements.json` | Parsed section tree + 292 extracted requirements | `npm run ingest` |
| `data/assessments/*.yaml` | Status, notes, and file mappings, one file per chapter | The UI, seed scripts, or by hand |
| `data/seeds/*.yaml` | Claude-authored mapping proposals | Claude |

The server re-reads the assessment YAMLs whenever their mtime changes, so edits made by a
script or by hand show up without a restart.

The vendored spec content under `data/spec/` is [NIST SP 800-63B rev 4](https://pages.nist.gov/800-63-4/sp800-63b.html),
a work of the U.S. Government in the public domain. It is copied verbatim so that parsing is
reproducible and the tool works offline.

## Scripts

```bash
npm run ingest                                        # re-parse the vendored spec HTML
npm run seed:template                                 # add not-assessed skeletons for every requirement
npm run seed:apply -- data/seeds/<file>.yaml          # merge a Claude-authored seed
npm run check                                         # validate assessments (schema, paths, line bounds, drift)
```

## The seeding contract

Claude proposes mappings; a human confirms them. `apply-seed.ts` enforces this:

- It writes entries with `seededBy: claude` and **always** `verified: false`.
- It **refuses to overwrite** any entry where `verified: true` or `seededBy: human`.
  Those are reported as skipped.
- Editing anything in the UI stamps `seededBy: human`, which permanently protects it
  from later seed runs.

The dashboard's "Claude-seeded, awaiting review" queue is the human review worklist.

`npm run check` also warns when a mapping's `snippet` no longer appears within ±20 lines of
its recorded `startLine` — that's how line drift surfaces as identity-idp changes, rather
than mappings silently pointing at the wrong code.

## Provenance and AI involvement

The application contains **no AI at runtime** — no model calls, no API keys, no inference.
It is a local Express + React app that reads YAML and source files off disk. The only
outbound network request in the whole project is in `scripts/ingest-spec.ts`, which fetches
the NIST page once so it can be vendored.

AI was used in two places, both deliberate:

1. **Authorship.** The initial implementation was written with Claude Code.
2. **The seeded assessments.** The mappings in `data/seeds/` and every entry marked
   `seededBy: claude` are LLM-authored proposals — a first pass at "which code implements
   this requirement," including the status and the reasoning in the notes. They are
   **assertions, not findings**, until a human checks the box.

The `seededBy` and `verified` fields exist precisely so this distinction survives in the
data. Any compliance claim from this tool should cite `verified: true` entries only; the
dashboard's "awaiting review" queue is everything that has not yet cleared that bar.

## Requirement IDs

IDs are `{sectionNumber}-R{ordinal}`, e.g. `3.1.1.2-R21`. Since the raw HTML is vendored,
re-parsing is deterministic and IDs are stable. Each requirement also carries a `textHash`
so IDs can be reconciled if the parser itself changes.

## Known parser notes

- A stem paragraph ending in a colon ("The verifier SHALL:") followed by a list produces one
  requirement per list item, with the stem preserved as `context`.
- Definitional sections (Notations, Glossary, References, Change Log, Abbreviations) are
  excluded from extraction — their ALL-CAPS keywords are definitions, not requirements.
- False positives can be marked `not-applicable` with a note; the parser does not need to be
  perfect for the tool to be useful.
