---
title: "AI Agent Risk Assessment Worksheet — NIST 800-63 Compliance Tracker"
description: "Structured risk assessment aligned with NIST AI RMF — threat analysis, control assessment, and sign-off for the two agentic layers and revision detection"
status: draft
tier: 3
last_updated: "2026-08-11"
nist_controls: ["RA-3", "RA-5"]
frameworks: ["NIST AI RMF 1.0", "OWASP Top 10 LLM 2025", "OWASP Top 10 Agentic 2026"]
audience: "isso"
keywords: ["risk-assessment", "AI-RMF", "threat-analysis", "OWASP", "usai", "egress"]
related_files: ["AGENTS.md", "docs/decisions/0002-agentic-layers-usai.md", "docs/decisions/0004-revision-detection.md"]
load_priority: "reference-only"
review_cycle: "semi-annually"
---

<!-- LOAD: reference-only — Load only when performing a risk assessment or preparing ATO documentation. -->
<!-- Pre-filled from PROJECT_PLAN.md + ADR-0002/0004. Values marked [TBD] require human/ISSO scoring and sign-off. -->

# AI Agent Risk Assessment Worksheet — NIST 800-63 Compliance Tracker

---

## Section 1: System Identification

| Field | Value |
|-------|-------|
| **System Name** | NIST 800-63 Compliance Tracker (`NIST-800-63-tracker`) |
| **System Owner** | TBD |
| **ISSO** | TBD |
| **FIPS Impact Level** | [x] Low [ ] Moderate [ ] High |
| **ATO Status** | [ ] Active [ ] In process [x] Pre-ATO |
| **Assessment Date** | 2026-08-11 |
| **Assessor Name/Title** | TBD |
| **Next Review Date** | TBD |

---

## Section 2: AI Agent Identification

| Field | Value |
|-------|-------|
| **Agent Name/Product** | OpenCode (authoring-time), via GSA USAi gateway |
| **Agent Version** | TBD |
| **Agent Vendor** | GSA USAi (LiteLLM gateway fronting frontier models) |
| **Deployment Model** | [x] Local (runs on developer machine) [ ] Cloud SaaS [ ] Self-hosted |
| **FedRAMP Status** | [ ] Authorized [ ] In process [ ] Not applicable [x] Unknown (confirm USAi gateway authorization boundary) |
| **Data Residency** | [x] US only [ ] International [ ] Unknown (confirm for USAi) |
| **Training Data Opt-Out** | [ ] Confirmed opt-out [ ] Opt-out not available [x] Unknown (confirm USAi terms) |

### Agent Capabilities

- [x] Code generation and modification
- [x] File system read access
- [x] File system write access (project data files only; see Data Handling)
- [x] Command/shell execution (developer's local dev environment)
- [x] Network access (external) — **only** the GSA USAi gateway and NIST CSRC/pages.nist.gov
- [ ] Network access (internal)
- [ ] Database access (no database)
- [x] Git operations (commit, push) — requires human approval per AGENTS.md
- [x] CI/CD pipeline interaction — requires human approval per AGENTS.md
- [x] Package/dependency installation — requires human approval, exact-version pins
- [ ] Infrastructure management
- [x] Other: LLM inference calls (authoring scripts only, never the runtime app)

---

## Section 3: Data Classification

### 3.1 Data Types Accessible to the Agent

| Data Type | Present? | Classification | Agent Needs Access? |
|-----------|----------|---------------|-------------------|
| Source code | [x] Yes | identity-idp source (CUI-adjacent); tracker source (public) | [x] Yes (read-only via safePath for Layer B) |
| Configuration files | [x] Yes | Public/internal | [x] Yes |
| Environment variables | [x] Yes | `USAI_API_KEY` (secret), `IDP_ROOT` (path) | [x] Yes (reads key from env; never logs it) |
| API keys/tokens/secrets | [x] Yes | `USAI_API_KEY` | [x] Yes (read from env only) |
| PII (names, SSN, etc.) | [ ] No | — | [ ] No |
| PHI (health records) | [ ] No | — | [ ] No |
| Financial data | [ ] No | — | [ ] No |
| CUI (Controlled Unclassified) | [x] Yes | Compliance findings about identity-idp | [x] Yes (produces/edits them) |
| Classified data | [ ] No | — | [ ] No |
| Internal network info | [ ] No | — | [ ] No |
| User credentials | [ ] No | — | [ ] No |
| Test/sample data | [x] Yes | Public (vendored NIST spec) | [x] Yes |

### 3.2 Data Flow

| Destination | Authorized? | Encrypted? |
|------------|-------------|------------|
| Agent vendor cloud (prompts/code) — **GSA USAi gateway** | [x] Yes (spec text in Layer A; identity-idp source snippets in Layer B) | [x] Yes (TLS) |
| Agent vendor training pipeline | [ ] Yes [ ] No [x] Opted out — **confirm with USAi terms [TBD]** | N/A |
| Local file system | [x] Yes | [ ] N/A (local) |
| Version control (remote) — GitHub | [x] Yes (human-approved; do not publish verified CUI gap findings without review) | [x] Yes |
| CI/CD system — GitHub Actions | [x] Yes (typecheck + check only) | [x] Yes |
| External APIs — NIST CSRC / pages.nist.gov | [x] Yes (read-only revision detection + one-time spec vendoring) | [x] Yes |
| Log aggregation system | [ ] No | N/A |

> **Key egress note:** Layer B transmits identity-idp **source snippets** to the
> GSA USAi gateway. This is the primary new data-flow introduced by ADR-0002 and
> the main reason this assessment exists.

---

## Section 4: Threat Analysis

Rate each threat for this deployment. **Likelihood** 1–5, **Impact** 1–5, **Risk = L × I**. The scores below are a **proposed starting point authored during bootstrap; the ISSO reviews and confirms or adjusts each one** before sign-off.

| # | Threat | OWASP Ref | Likelihood | Impact | Risk | Existing Mitigations | Residual |
|---|--------|-----------|-----------|--------|------|---------------------|----------|
| T1 | **Prompt injection** — malicious text in vendored spec HTML or identity-idp source steers the model | LLM01, Agentic-01 | 2 | 3 | 6 | Spec/source treated as data not instructions (AGENTS.md); output schema-validated; human verifies all records | TBD |
| T2 | **Sensitive data disclosure** — identity-idp source (CUI-adjacent) egresses to USAi, or secrets leak in logs | LLM02 | 3 | 3 | 9 | Egress confined to GSA USAi gateway; `USAI_API_KEY` from env, never logged; Layer B opt-in and human-approved. **Agentic mode (ADR-0005):** the model selects files but only via read-only, `safePath`-bounded tools; identity-idp `.gitignore` + a hard sensitive-path denylist (`.env*`, `*.key`, `*.pem`, `*_secret*`, `config/secrets*`, `.git/`) block sensitive reads; every tool call is recorded to a per-run audit log; per-requirement read/search budgets cap volume. **In-app discovery (ADR-0006):** the running app triggers a headless OpenCode agent (`opencode run --dir IDP_ROOT`); egress controls shift to the sandbox allowlist + OpenCode's read-only permissions + session transcript (coarser than the ADR-0005 audit log) | TBD |
| T3 | **Supply chain compromise** — malicious/vulnerable dependency | LLM03, Agentic-07 | 2 | 3 | 6 | Exact-version pins; no critical/high CVEs; dep install requires approval | TBD |
| T4 | **Insecure code generation** | LLM05 | 2 | 2 | 4 | `docs/CODING_PRACTICES.md`; typecheck; code review before merge | TBD |
| T5 | **Excessive agency** — agent writes/verifies beyond intent | LLM06, Agentic-06 | 2 | 4 | 8 | Provenance lock: AI writes only `verified:false`/`seededBy:claude`; refuses to overwrite verified/human records; cannot set `verified:true` | TBD |
| T6 | **Credential compromise** — `USAI_API_KEY` exposed | Agentic-02 | 2 | 4 | 8 | Key from env only; gitignored `.env`; never in code/logs/fixtures | TBD |
| T7 | **Unauthorized code execution** — untrusted external code run | Agentic-03 | 1 | 4 | 4 | Runtime app makes no external calls; ingest fetches data (not code) | TBD |
| T8 | **Context/memory poisoning** — model context manipulated across records | Agentic-08 | 2 | 3 | 6 | Per-record prompts; output schema-validated; human review | TBD |
| T9 | **Audit trail gaps** — cannot reconstruct which records the AI touched | Agentic-02 | 2 | 3 | 6 | `seededBy`/`updatedAt` on every record; git history; `npm run check` | TBD |
| T10 | **Human trust exploitation** — reviewer over-trusts AI-seeded records and marks verified without checking | Agentic-05 | 3 | 4 | 12 | "Awaiting review" queue; AI records are proposals not findings; README/AGENTS.md emphasize verify-before-cite | TBD |
| T11 | **Stale spec / silent revision drift** — tool audits against an outdated revision | — | 3 | 3 | 9 | Report-only CSRC detection (ADR-0004); human-triggered ingest; registry records source + date | TBD |
| T12 | **Verified findings silently invalidated on migration** | — | 2 | 4 | 8 | Migration never auto-transfers `verified:true`; carry-forward is unverified re-review (ADR-0004) | TBD |

### Risk Tolerance

| Risk Level | Score Range | Action Required |
|-----------|-------------|-----------------|
| **Critical** | 20-25 | MUST mitigate before agent deployment |
| **High** | 12-19 | MUST mitigate within 30 days of deployment |
| **Medium** | 6-11 | SHOULD mitigate; document accepted risk if deferred |
| **Low** | 1-5 | MAY accept with documentation |

> Highest proposed scores: **T10 (human over-trust, 12)** and the egress/agency
> cluster **T2/T5/T6/T11 (8–9)**. These are the risks the design's provenance
> invariant, egress confinement, and report-only detection are built to mitigate.

---

## Section 5: Control Assessment

| Control Area | Status | Notes |
|-------------|--------|-------|
| **Agent Identity (IA-2, AU-3)** — records attributable to the agent | [x] Implemented | `seededBy: claude` on every AI-written record |
| **Least Privilege (AC-6)** — permissions scoped to minimum | [x] Partial | `IDP_ROOT` read-only via `safePath`; runtime app AI-free; confirm USAi scope |
| **Human-in-the-Loop (AC-3)** — sensitive actions require approval | [x] Implemented | Only humans set `verified:true`; ingest/migration/commit are human-gated |
| **Audit Logging (AU-2)** — actions logged with attribution | [x] Partial | `seededBy`/`updatedAt` + git history; consider explicit run logs for agentic scripts |
| **Secrets Scanning (SA-11)** — pre-commit prevents credential leaks | [ ] Not implemented | **Action:** add pre-commit secrets scan (federal-repo-setup) |
| **SAST/SCA (RA-5)** — code scanned in CI | [ ] Partial | typecheck + `npm run check` in CI; add SCA/secrets scan |
| **Branch Protection (CM-3)** — no direct push to protected branches | [ ] Not implemented | **Action:** configure on GitHub |
| **Dependency Scanning (SR-3, RA-5)** — packages scanned for CVEs | [ ] Not implemented | **Action:** add to CI |
| **Session Management (AC-12)** — no credential persistence | [x] Implemented | Key read from env per run; not persisted |
| **Incident Response (IR-4)** — IR covers agent scenarios | [ ] Not implemented | TBD |
| **Data Handling (SC-7, SC-8)** — agent cannot access/transmit unauthorized data | [x] Partial | `safePath` boundary; egress only to USAi/CSRC; confirm USAi data handling |
| **Configuration Management (CM-2)** — agent config version-controlled | [x] Implemented | `opencode.jsonc`, `AGENTS.md`, ADRs all in git |

---

## Section 6: Risk Treatment Plan

### Risk: T10 — Human trust exploitation (over-trusting AI-seeded records)

| Field | Value |
|-------|-------|
| **Risk Score** | 12 [TBD confirm] |
| **Treatment** | [x] Mitigate |
| **Planned Controls** | UI clearly badges `seededBy: claude, verified: false`; "awaiting review" queue; documentation that only `verified:true` records are citable findings |
| **Responsible Party** | TBD |
| **Target Completion** | TBD |
| **Verification Method** | UI review; spot-check that verified records were human-confirmed |

### Risk: T2 — Sensitive data disclosure (identity-idp source egress to USAi)

| Field | Value |
|-------|-------|
| **Risk Score** | 9 [TBD confirm] |
| **Treatment** | [x] Mitigate |
| **Planned Controls** | Egress confined to GSA USAi gateway; Layer B opt-in + human-approved; confirm USAi FedRAMP status, data residency, and training opt-out |
| **Responsible Party** | TBD (ISSO to confirm USAi boundary) |
| **Target Completion** | TBD |
| **Verification Method** | Network review of Layer B; USAi terms confirmation |

### Risk: T11 — Stale spec / silent revision drift

| Field | Value |
|-------|-------|
| **Risk Score** | 9 [TBD confirm] |
| **Treatment** | [x] Mitigate |
| **Planned Controls** | Report-only CSRC detection (ADR-0004); registry records source URL + ingest date; human-triggered adoption |
| **Responsible Party** | TBD |
| **Target Completion** | TBD |
| **Verification Method** | Detection run surfaces newer revs; registry review |

*(Copy this block for each additional risk requiring treatment.)*

---

## Section 7: Acceptance and Sign-Off

### Risk Acceptance Statement

Based on this assessment, the residual risk of using OpenCode (via the GSA USAi gateway) in the NIST 800-63 Compliance Tracker is:

[ ] **Acceptable** — Proceed under the documented controls
[ ] **Conditionally Acceptable** — Proceed after completing pre-deployment treatment items (secrets scanning, branch protection, USAi boundary confirmation)
[ ] **Not Acceptable** — Do not proceed until identified risks are mitigated

### Signatures

| Role | Name | Signature | Date |
|------|------|-----------|------|
| **System Owner** | TBD | | |
| **ISSO** | TBD | | |
| **Authorizing Official** (if required) | TBD | | |

---

## Appendix: Revision History

| Date | Version | Assessor | Changes |
|------|---------|----------|---------|
| 2026-08-11 | 0.1 (draft) | OpenCode (pre-fill) | Initial pre-fill from PROJECT_PLAN.md + ADR-0002/0003/0004; scores marked [TBD] for ISSO |
