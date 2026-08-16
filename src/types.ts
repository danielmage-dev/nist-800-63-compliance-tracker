export type ReqLevel = 'SHALL' | 'SHALL_NOT' | 'SHOULD' | 'SHOULD_NOT' | 'MAY';

export type Status =
  | 'compliant'
  | 'partial'
  | 'gap'
  | 'not-assessed'
  | 'not-applicable';

export type SeededBy = 'parser' | 'claude' | 'human';

/** Lifecycle status of a spec revision in the registry */
export type RevisionStatus = 'draft' | 'final' | 'superseded' | 'active';

/**
 * A single NIST SP 800-63 revision the tool tracks. `revKey` is the on-disk
 * directory / API path segment (e.g. "800-63b-r4"); it uniquely identifies the
 * revision across the whole system.
 */
export interface RevisionMeta {
  /** Directory + API key, e.g. "800-63b-r4" */
  revKey: string;
  /** Document short name, e.g. "sp800-63b" */
  doc: string;
  /** Revision label, e.g. "4" or "3" */
  rev: string;
  /** Human-facing label, e.g. "SP 800-63B rev 4" */
  label: string;
  status: RevisionStatus;
  /** Canonical NIST URL the spec was vendored from */
  sourceUrl: string;
  /** ISO timestamp of the ingest that produced this revision's data */
  ingestedAt: string;
}

export interface SpecSection {
  /** Canonical key parsed from heading text, e.g. "5.1.1.2" or "A" */
  number: string;
  title: string;
  /** Original HTML id from the NIST page, kept for anchor rewriting */
  anchor: string;
  /** Heading depth: 1 for chapters/appendices, up to 4 */
  level: number;
  /** Sanitized body HTML with data-req-id spans; empty for pure container sections */
  html: string;
  children: SpecSection[];
}

export interface Requirement {
  /** "{sectionNumber}-R{ordinal}", e.g. "5.1.1.2-R3"; unique within a revision */
  id: string;
  /** Revision this requirement belongs to, e.g. "800-63b-r4" */
  rev: string;
  sectionNumber: string;
  ordinal: number;
  level: ReqLevel;
  text: string;
  /** First 12 hex chars of sha256 of whitespace-normalized text; reconciliation key */
  textHash: string;
  /** Stem sentence when this requirement is a list item under "The verifier SHALL:" */
  context?: string;
  source: 'prose' | 'table';
  /** Who produced this requirement record. Parser output is `parser`. */
  seededBy: SeededBy;
  /** Human confirmed the extraction. Only a human may set this true. */
  verified: boolean;
}

export interface FileRef {
  /** Relative to IDP_ROOT, e.g. "app/services/rate_limiter.rb" */
  path: string;
  startLine?: number;
  endLine?: number;
  /** Short verbatim anchor text so the ref can be re-located when lines drift */
  snippet?: string;
  note?: string;
}

export interface Assessment {
  reqId: string;
  /** Revision this assessment belongs to, e.g. "800-63b-r4" */
  rev: string;
  status: Status;
  notes: string;
  refs: FileRef[];
  /** Human confirmed — seeding must never touch entries with verified: true */
  verified: boolean;
  seededBy?: SeededBy;
  updatedAt: string;
}

export interface ChapterAssessments {
  chapter: string;
  /** Revision this chapter file belongs to, e.g. "800-63b-r4" */
  rev: string;
  assessments: Record<string, Assessment>;
}

export interface ChapterRequirements {
  chapter: string;
  /** Revision this chapter file belongs to, e.g. "800-63b-r4" */
  rev: string;
  requirements: Record<string, Requirement>;
}

/** Requirement joined with its assessment status — nav badges + dashboard payload */
export interface RequirementWithStatus extends Requirement {
  status: Status;
  /** Assessment verification (distinct from requirement.verified) */
  assessed: boolean;
  assessmentSeededBy?: SeededBy;
  refCount: number;
}
