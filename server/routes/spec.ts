import { Router } from 'express';
import { getSpec, findSection, getRequirements, requirementsWithStatus, setRequirementVerified } from '../lib/store.ts';
import { startDiscovery, getJob } from '../lib/discovery.ts';
import type { SpecSection } from '../../src/types.ts';

export const specRouter = Router({ mergeParams: true });

type NavSection = Omit<SpecSection, 'html' | 'children'> & { children: NavSection[] };

function stripHtml(s: SpecSection): NavSection {
  const { html: _html, children, ...rest } = s;
  return { ...rest, children: children.map(stripHtml) };
}

specRouter.get('/sections', (req, res, next) => {
  try {
    const rev = (req.params as { rev: string }).rev;
    const spec = getSpec(rev);
    res.json({
      rev,
      source: spec.source,
      ingestedAt: spec.ingestedAt,
      sections: spec.sections.map(stripHtml),
    });
  } catch (err) {
    next(err);
  }
});

specRouter.get('/sections/:number', (req, res, next) => {
  try {
    const { rev, number } = req.params as { rev: string; number: string };
    const section = findSection(rev, number);
    if (!section) return res.status(404).json({ error: 'Section not found' });
    const collect = (s: SpecSection): string[] => [
      s.number,
      ...s.children.flatMap(collect),
    ];
    const numbers = new Set(collect(section));
    res.json({
      section,
      requirements: getRequirements(rev).filter((r) => numbers.has(r.sectionNumber)),
    });
  } catch (err) {
    next(err);
  }
});

specRouter.get('/requirements', (req, res, next) => {
  try {
    res.json(requirementsWithStatus((req.params as { rev: string }).rev));
  } catch (err) {
    next(err);
  }
});

// Set a requirement's own extraction-provenance (human verify/unverify).
specRouter.put('/requirements/:reqId/verified', async (req, res, next) => {
  try {
    const { rev, reqId } = req.params as { rev: string; reqId: string };
    const verified = Boolean((req.body as { verified?: unknown })?.verified);
    const updated = await setRequirementVerified(rev, reqId, verified);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Agentic discovery (ADR-0006): start a background job that runs the OpenCode
// agent to find supporting code and write a provenance-locked proposal.
specRouter.post('/requirements/:reqId/discover', (req, res, next) => {
  try {
    const { rev, reqId } = req.params as { rev: string; reqId: string };
    const job = startDiscovery(rev, reqId);
    res.status(202).json(job);
  } catch (err) {
    next(err);
  }
});

specRouter.get('/requirements/:reqId/discover', (req, res, next) => {
  try {
    const { rev, reqId } = req.params as { rev: string; reqId: string };
    const job = getJob(rev, reqId);
    if (!job) return res.status(404).json({ error: 'No discovery job for this requirement.' });
    res.json(job);
  } catch (err) {
    next(err);
  }
});
