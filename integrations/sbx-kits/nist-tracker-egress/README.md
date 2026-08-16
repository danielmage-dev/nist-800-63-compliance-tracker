# nist-tracker-egress — sbx mixin kit

A project-scoped [sbx](https://github.com/GSA-TTS/agentic-coding-patterns/tree/main/integrations/isolation/sbx-kits)
mixin kit that allow-lists the two NIST hosts the NIST 800-63 Compliance Tracker
needs for its authoring-time scripts, on an otherwise default-deny egress network.

## Why this exists

The tracker's **reviewer application** (Vite UI + Express API) makes **no network
calls** and binds to `127.0.0.1`. Network egress is required only by three
**opt-in, operator-invoked** scripts:

| Script | Host | Purpose |
| --- | --- | --- |
| `scripts/layer-map.ts`, `scripts/layer-extract.ts` | `api.gsa.usai.gov` | LLM inference (agentic Layers A/B) |
| `scripts/detect-revisions.ts` | `csrc.nist.gov` | report-only revision detection |
| `scripts/ingest-spec.ts` | `pages.nist.gov` | one-time spec vendoring (new revisions only) |

**This kit allow-lists only the two NIST hosts** (`pages.nist.gov`,
`csrc.nist.gov`). The USAi endpoint (`api.gsa.usai.gov`) is **already** provided
by the built-in **`usai-provider`** kit that `acq` applies on every run, so it is
deliberately not repeated here. This kit is the one **extra** kit you add for the
tracker.

## Usage

The tracker is always run inside the `acq`/`sbx` sandbox. `acq` automatically
applies its built-in kits (`usai-provider`, `agentic-coding-playbook`,
`zscaler-ca-certificate`, `git-ssh-sign`); you only supply this one extra kit.

**Primary — `acq` (msb or sbx backend):** add this kit via `ACQ_EXTRA_KITS`
(a whitespace-separated list of kit refs; local paths are fine, no
`ACQ_EXTRA_KIT_SOURCES` needed for a local path). Extras are applied **after**
the built-ins, so they win on any overlap — here they simply add two NIST hosts
to the egress allowlist alongside the USAi host the `usai-provider` kit already
allows:

```bash
export ACQ_EXTRA_KITS="./integrations/sbx-kits/nist-tracker-egress"
acq run opencode /path/to/NIST-800-63-tracker
```

`ACQ_EXTRA_KITS` also works when re-running against an existing sandbox: setting
it and re-running `acq run` against the same project injects just this kit.

**Alternative — raw `sbx` backend directly:** if you drive `sbx` yourself rather
than through `acq`, pass this kit (and, since you are bypassing `acq`'s built-ins,
the `usai-provider` kit too) with explicit `--kit` flags:

```bash
sbx run \
  --kit <path-to>/agentic-coding-patterns/integrations/isolation/sbx-kits/usai-provider-kit \
  --kit integrations/sbx-kits/nist-tracker-egress \
  opencode NIST-800-63-tracker
```

The USAi API key is handled by `acq`/the `usai-provider` kit (injected at
runtime; it never enters the guest). This kit needs **no secrets** — both NIST
hosts are read-only, unauthenticated, TLS.

## What it does

Declaratively (`spec.yaml`):

- `caps.network.allow`: adds `pages.nist.gov` and `csrc.nist.gov` (default port
  443) to the sandbox egress allowlist.

It ships no files and runs no startup commands.

## Verifying

Inside a provisioned sandbox:

```bash
# Revision detection should reach CSRC (report-only; never vendors a spec):
npm run detect:revisions

# Adopting a new revision fetches its spec HTML from pages.nist.gov once:
npm run ingest -- --rev <newRevKey>
```

If egress is still blocked you'll see a `Blocked by network policy` / `403`
from the host — confirm this kit was passed via `ACQ_EXTRA_KITS` (or `--kit`)
and that the host names match exactly (no scheme, no path).

## Compliance references

- `AGENTS.md` → "Network Access" (authorized endpoints)
- `docs/decisions/0002-agentic-layers-usai.md` — USAi egress decision (SC-7, SC-8)
- `docs/decisions/0004-revision-detection.md` — CSRC report-only detection (SC-7)
- `docs/risk-assessment.md` — T2 (source egress), T11 (stale-spec drift)

Behavioral/policy authority lives in the playbook and this project's `AGENTS.md`;
this kit only configures the sandbox and carries no compliance authority of its own.
