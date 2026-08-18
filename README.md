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

Two commands: `setup` once (or to refresh the spec), then `start` each session.

```bash
npm run setup   # install deps, ingest the spec, seed skeletons, validate
npm start       # start the app (Vite + Express API)
```

`npm run setup` is idempotent — safe to re-run to refresh parser output/skeletons.
`npm start` just runs the dev servers (fast). Vite serves the UI on
http://localhost:5180, the Express API on :3001. The app opens on the `active`
revision; use the header selector to switch.

### Running in the sandbox (recommended)

The tool is designed to run inside the `acq`/sbx sandbox, where the OpenCode agent
(for the "Find supporting code" button) and USAi access are provided by acq's
built-in kits. A host launcher automates sandbox creation:

```bash
./run-sandbox.sh    # host: create sandbox (mounts tracker + identity-idp),
                    #       apply the NIST egress kit, publish ports, print the URL
```

Then, in the guest session it opens:

```bash
npm run setup       # first time / to refresh
npm start           # start the app
```

Open the UI on your host at the **host port mapped to 5180** (the launcher prints
it; re-check anytime with `./acq ports nist-tracker`). The launcher assumes
sibling checkouts of `identity-idp` and `agentic-coding-quickstart`; override with
`IDP_DIR=… ACQ_DIR=… ./run-sandbox.sh`. The **egress kit** allow-lists
`pages.nist.gov` + `csrc.nist.gov` (for spec ingest / revision detection); USAi
egress comes from acq's built-in `usai-provider` kit.

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

## Adding a revision or document

`rev` is a first-class dimension, and a `revKey` encodes both the document and the
revision (e.g. `800-63b-r4`). Adding another revision (e.g. a future rev 5) or another
document in the family (e.g. **SP 800-63A** identity proofing, **800-63C** federation)
is additive — no code changes to the core, just data:

1. **Vendor the NIST HTML.** Save the document's single-page HTML at
   `data/spec/<revKey>/raw/<doc>.html`, where `<doc>` matches the registry `doc`
   field (the ingest derives the filename from it). Example:
   `data/spec/800-63c-r4/raw/sp800-63c.html`.
2. **Add a registry entry** to `data/revisions.json`:
   ```json
   {
     "revKey": "800-63c-r4",
     "doc": "sp800-63c",
     "rev": "4",
     "label": "SP 800-63C rev 4",
     "status": "final",
     "sourceUrl": "https://pages.nist.gov/800-63-4/sp800-63c.html",
     "ingestedAt": ""
   }
   ```
   (If the `raw/` HTML is absent, ingest will fetch it from `sourceUrl` — which
   requires `pages.nist.gov` egress; see the sbx egress kit under `integrations/`.)
3. **Ingest and seed:**
   ```bash
   npm run ingest -- --rev 800-63c-r4
   npm run seed:template -- --rev 800-63c-r4
   npm run check -- --rev 800-63c-r4
   ```

The revision then appears in the UI's revision selector, with its own requirements
and assessments, independent of other revisions.

> **Parser caveat.** The ingest parser assumes the NIST **800-63-4 page template**
> — specifically that the document body begins at an `<h1 id="abstract">` element
> (`scripts/ingest-spec.ts`). The 63-4 family (63, 63A, 63B, 63C, 63D) shares this
> template, so those ingest without changes. A structurally different page (a
> future rev with a redesigned layout) may need the content-root detection in
> `ingest-spec.ts` adjusted. Chapter titles, section numbering, requirement
> extraction, link/asset rewriting, and all storage paths are already derived
> generically and need no per-document changes.

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
