import { Router } from 'express';
import { spec, findSection, requirements, requirementsWithStatus } from '../lib/store.ts';
import type { SpecSection } from '../../src/types.ts';

export const specRouter = Router();

type NavSection = Omit<SpecSection, 'html' | 'children'> & { children: NavSection[] };

function stripHtml(s: SpecSection): NavSection {
  const { html: _html, children, ...rest } = s;
  return { ...rest, children: children.map(stripHtml) };
}

specRouter.get('/sections', (_req, res) => {
  res.json({
    source: spec.source,
    ingestedAt: spec.ingestedAt,
    sections: spec.sections.map(stripHtml),
  });
});

specRouter.get('/sections/:number', (req, res) => {
  const section = findSection(req.params.number);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  const collect = (s: SpecSection): string[] => [
    s.number,
    ...s.children.flatMap(collect),
  ];
  const numbers = new Set(collect(section));
  res.json({
    section,
    requirements: requirements.filter((r) => numbers.has(r.sectionNumber)),
  });
});

specRouter.get('/requirements', (_req, res) => {
  res.json(requirementsWithStatus());
});
