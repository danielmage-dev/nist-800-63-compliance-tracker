import type { ReqLevel, Status } from './types';

export const STATUS_META: Record<Status, { label: string; color: string }> = {
  'compliant': { label: 'Compliant', color: 'var(--ok)' },
  'partial': { label: 'Partial', color: 'var(--warn)' },
  'gap': { label: 'Gap', color: 'var(--bad)' },
  'not-assessed': { label: 'Not assessed', color: 'var(--muted)' },
  'not-applicable': { label: 'N/A', color: 'var(--na)' },
};

export const STATUS_ORDER: Status[] = [
  'compliant', 'partial', 'gap', 'not-applicable', 'not-assessed',
];

export const LEVEL_LABEL: Record<ReqLevel, string> = {
  SHALL: 'SHALL',
  SHALL_NOT: 'SHALL NOT',
  SHOULD: 'SHOULD',
  SHOULD_NOT: 'SHOULD NOT',
  MAY: 'MAY',
};

export const NORMATIVE: ReqLevel[] = ['SHALL', 'SHALL_NOT'];
export const RECOMMENDED: ReqLevel[] = ['SHOULD', 'SHOULD_NOT'];
