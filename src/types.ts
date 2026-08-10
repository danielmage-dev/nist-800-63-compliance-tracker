export type ReqLevel = 'SHALL' | 'SHALL_NOT' | 'SHOULD' | 'SHOULD_NOT' | 'MAY';

export type Status =
  | 'compliant'
  | 'partial'
  | 'gap'
  | 'not-assessed'
  | 'not-applicable';

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
  /** "{sectionNumber}-R{ordinal}", e.g. "5.1.1.2-R3" */
  id: string;
  sectionNumber: string;
  ordinal: number;
  level: ReqLevel;
  text: string;
  /** First 12 hex chars of sha256 of whitespace-normalized text; reconciliation key */
  textHash: string;
  /** Stem sentence when this requirement is a list item under "The verifier SHALL:" */
  context?: string;
  source: 'prose' | 'table';
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
  status: Status;
  notes: string;
  refs: FileRef[];
  /** Human confirmed — seeding must never touch entries with verified: true */
  verified: boolean;
  seededBy?: 'claude' | 'human';
  updatedAt: string;
}

export interface ChapterAssessments {
  chapter: string;
  assessments: Record<string, Assessment>;
}

/** Requirement joined with its assessment status — nav badges + dashboard payload */
export interface RequirementWithStatus extends Requirement {
  status: Status;
  verified: boolean;
  seededBy?: 'claude' | 'human';
  refCount: number;
}
