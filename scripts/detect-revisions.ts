/**
 * Revision detection (report-only) — ADR-0004.
 *
 * Queries the NIST CSRC publications search for the SP 800-63 family, newest
 * first, including drafts, and compares what NIST currently publishes against
 * the local revision registry (data/revisions.json). It REPORTS newer or
 * unknown revisions; it NEVER vendors, ingests, or swaps a spec. A human
 * decides whether to adopt (and runs ingest explicitly).
 *
 * CSRC returns 403 to bare clients, so requests are sent with a browser
 * User-Agent. If the network is unavailable (e.g. sandbox egress deny), the
 * script reports that clearly and exits non-zero without touching data.
 *
 * Usage:
 *   npm run detect:revisions            # human-readable report
 *   npm run detect:revisions -- --json  # machine-readable
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RevisionMeta } from '../src/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AS_JSON = process.argv.includes('--json');

const SEARCH_URL =
  'https://csrc.nist.gov/publications/search?keywords-lg=800-63' +
  '&sortBy-lg=releasedate+DESC&viewMode-lg=brief&ipp-lg=all' +
  '&status-lg=Final%2CDraft&series-lg=SP&topicsMatch-lg=ANY&controlsMatch-lg=ANY';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface DetectedPub {
  /** e.g. "SP 800-63B Rev. 4" */
  title: string;
  /** e.g. "sp800-63b" if derivable */
  doc?: string;
  /** e.g. "4" if derivable */
  rev?: string;
  /** "Final" | "Draft" | other */
  status: string;
  /** canonical CSRC landing URL */
  url: string;
  /** release date text as published */
  released?: string;
}

/**
 * Parse the CSRC brief-view results HTML into publications. CSRC markup can
 * change; this is intentionally defensive and degrades to [] rather than throw.
 */
function parseResults(html: string): DetectedPub[] {
  const pubs: DetectedPub[] = [];
  // Each result links to a /pubs/... landing page; capture link + title text.
  const linkRe =
    /<a[^>]+href="(\/pubs\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const url = `https://csrc.nist.gov${m[1]}`;
    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/800-63/i.test(title) || seen.has(url)) continue;
    seen.add(url);
    // Status: look for a nearby "Final"/"Draft" token in the surrounding block.
    const tail = html.slice(m.index, m.index + 600);
    const status = /\bFinal\b/i.test(tail)
      ? 'Final'
      : /\bDraft\b/i.test(tail)
        ? 'Draft'
        : 'Unknown';
    const released = tail.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/)?.[0]
      ?? tail.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/)?.[0];
    // Derive doc/rev from the title where possible: "SP 800-63B Rev. 4"
    const rm = title.match(/800-63([a-dA-D]?)\b.*?(?:Rev\.?\s*|Revision\s*)(\d+)/i);
    const doc = rm ? `sp800-63${rm[1].toLowerCase()}` : undefined;
    const rev = rm ? rm[2] : undefined;
    pubs.push({ title, doc, rev, status, url, ...(released ? { released } : {}) });
  }
  return pubs;
}

function loadRegistry(): RevisionMeta[] {
  return JSON.parse(readFileSync(path.join(ROOT, 'data/revisions.json'), 'utf8'));
}

async function main() {
  const registry = loadRegistry();
  const known = new Set(
    registry.map((r) => `${r.doc}:${r.rev}`.toLowerCase()),
  );

  let html: string;
  try {
    const res = await fetch(SEARCH_URL, { headers: BROWSER_HEADERS });
    if (!res.ok) {
      throw new Error(`CSRC returned HTTP ${res.status}`);
    }
    html = await res.text();
  } catch (e) {
    const msg = (e as Error).message;
    const hint = /network policy|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)
      ? ' (network egress may be blocked — allow csrc.nist.gov in the sandbox policy)'
      : '';
    console.error(`Revision detection failed: ${msg}${hint}`);
    process.exit(2);
  }

  const pubs = parseResults(html);
  const withRev = pubs.filter((p) => p.doc && p.rev);
  const newOnes = withRev.filter(
    (p) => !known.has(`${p.doc}:${p.rev}`.toLowerCase()),
  );

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        { checkedAt: new Date().toISOString(), source: SEARCH_URL, found: pubs, newRevisions: newOnes },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`NIST 800-63 revision check — ${new Date().toISOString()}`);
  console.log(`Source: ${SEARCH_URL}\n`);
  if (!pubs.length) {
    console.log(
      'No publications parsed. CSRC markup may have changed, or the query returned nothing.',
    );
    process.exit(1);
  }
  console.log(`Published (newest first):`);
  for (const p of pubs.slice(0, 15)) {
    const tag = p.doc && p.rev ? `${p.doc} rev ${p.rev}` : '(unparsed rev)';
    const isNew = p.doc && p.rev && !known.has(`${p.doc}:${p.rev}`.toLowerCase());
    console.log(`  ${isNew ? '★ NEW ' : '      '}[${p.status}] ${p.title}  ${tag}`);
    console.log(`         ${p.url}${p.released ? `  (${p.released})` : ''}`);
  }
  console.log('');
  if (newOnes.length) {
    console.log(`${newOnes.length} revision(s) not in your registry:`);
    for (const p of newOnes) {
      console.log(`  - ${p.doc} rev ${p.rev} [${p.status}] → ${p.url}`);
    }
    console.log(
      '\nTo adopt one: add it to data/revisions.json, then run ' +
        '`npm run ingest -- --rev <revKey>` (human-triggered; never automatic).',
    );
  } else {
    console.log('Your registry is up to date with all parsed revisions.');
  }
}

await main();
