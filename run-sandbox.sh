#!/usr/bin/env bash
#
# run-sandbox.sh — one-command host launcher for the NIST 800-63 Compliance Tracker.
#
# Creates (or re-attaches) the acq sandbox for this project with BOTH repos
# mounted (the tracker + identity-idp) and the NIST egress kit applied, publishes
# the UI/API ports to the host, and prints the URL to open. It does NOT start the
# dev servers — do that inside the guest with `npm run setup` (first time) then
# `npm start` (see README "Running in the sandbox").
#
# Prerequisites:
#   - acq installed (agentic-coding-quickstart checkout) — see $ACQ_DIR below.
#   - identity-idp checked out on the host (see $IDP_DIR below).
#   - A current USAi API key (acq prompts/validates on run).
#
# Override any path via environment variable, e.g.:
#   ACQ_DIR=~/code/agentic-coding-quickstart ./run-sandbox.sh
#
set -euo pipefail

# --- Resolve paths (override via env) --------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_DIR="${TRACKER_DIR:-$SCRIPT_DIR}"
# Sibling checkouts by default: ../identity-idp and ../agentic-coding-quickstart
IDP_DIR="${IDP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)/identity-idp}"
ACQ_DIR="${ACQ_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)/agentic-coding-quickstart}"

SANDBOX_NAME="${SANDBOX_NAME:-nist-tracker}"
EGRESS_KIT="$TRACKER_DIR/integrations/sbx-kits/nist-tracker-egress"
WEB_PORT=5180
API_PORT=3001

# --- Sanity checks ----------------------------------------------------------
[ -d "$TRACKER_DIR" ]  || { echo "ERROR: tracker dir not found: $TRACKER_DIR" >&2; exit 1; }
[ -d "$IDP_DIR" ]      || { echo "ERROR: identity-idp not found: $IDP_DIR (set IDP_DIR=...)" >&2; exit 1; }
[ -x "$ACQ_DIR/acq" ]  || { echo "ERROR: acq not found/executable at $ACQ_DIR/acq (set ACQ_DIR=...)" >&2; exit 1; }
[ -f "$EGRESS_KIT/spec.yaml" ] || { echo "ERROR: egress kit missing: $EGRESS_KIT" >&2; exit 1; }

echo "Tracker:      $TRACKER_DIR"
echo "identity-idp: $IDP_DIR"
echo "acq:          $ACQ_DIR/acq"
echo "egress kit:   $EGRESS_KIT"
echo

# --- Create the sandbox -----------------------------------------------------
# Mount the tracker as the primary workspace and identity-idp read-only (":ro")
# — it is a read-only audit boundary (see AGENTS.md), so we enforce that at the
# sandbox layer too, not just via safePath. Apply the NIST egress kit with --kit
# (USAi egress comes from acq's built-in usai-provider kit). `create` is
# detached, so this script returns; ports are published separately below via
# `acq ports` (the acq wrapper does not forward --publish to create).
echo "==> Creating sandbox '$SANDBOX_NAME' (detached)…"
"$ACQ_DIR/acq" create --name "$SANDBOX_NAME" \
  --kit "$EGRESS_KIT" \
  opencode "$TRACKER_DIR" "$IDP_DIR:ro"

# --- Publish ports ----------------------------------------------------------
# `acq create` does NOT auto-publish, so publish here — exactly ONCE. Note that
# `acq ports --publish` is ADDITIVE: calling it again stacks another host port
# onto the same guest port. So publish once; to read the mapping later, LIST
# with `acq ports <name>` (no --publish).
echo
echo "==> Publishing ports ($WEB_PORT, $API_PORT)…"
"$ACQ_DIR/acq" ports "$SANDBOX_NAME" --publish "$WEB_PORT" --publish "$API_PORT" || true

cat <<EOF

------------------------------------------------------------------------------
Sandbox '$SANDBOX_NAME' is ready.

  1. Open a session in the guest (re-attaches; mounts are read from the spec):
       cd "$ACQ_DIR" && ./acq run --name $SANDBOX_NAME opencode

  2. Inside the guest, from the tracker directory:
       npm run setup     # first time / to refresh spec + skeletons (install, ingest, seed, check)
       npm start         # start the app (Vite + API), then wait for "VITE ready"

  3. Find the UI port and open it (once npm start reports Vite is ready):
       cd "$ACQ_DIR" && ./acq ports $SANDBOX_NAME
     Open http://localhost:<HOST PORT mapped to SANDBOX PORT $WEB_PORT>.

Notes:
  - The UI (Vite) binds 0.0.0.0 in the guest so the published port is reachable;
    the file-serving API stays bound to 127.0.0.1 inside the guest.
  - Ports are ephemeral per sandbox. Re-read with 'acq ports $SANDBOX_NAME';
    do NOT re-run --publish (it stacks duplicate host ports).
------------------------------------------------------------------------------
EOF
