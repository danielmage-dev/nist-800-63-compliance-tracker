import { Router } from 'express';
import { getAssessment, putAssessment } from '../lib/store.ts';
import type { Assessment, FileRef, Status } from '../../src/types.ts';

export const assessmentsRouter = Router();

const STATUSES: Status[] = [
  'compliant', 'partial', 'gap', 'not-assessed', 'not-applicable',
];

assessmentsRouter.get('/assessments/:reqId', (req, res) => {
  res.json(getAssessment(req.params.reqId));
});

assessmentsRouter.put('/assessments/:reqId', async (req, res, next) => {
  try {
    const body = req.body as Partial<Assessment>;
    if (body.status && !STATUSES.includes(body.status)) {
      return res.status(400).json({ error: `Invalid status: ${body.status}` });
    }
    const refs: FileRef[] = Array.isArray(body.refs)
      ? body.refs.map((r) => ({
          path: String(r.path),
          ...(r.startLine != null ? { startLine: Number(r.startLine) } : {}),
          ...(r.endLine != null ? { endLine: Number(r.endLine) } : {}),
          ...(r.snippet ? { snippet: String(r.snippet) } : {}),
          ...(r.note ? { note: String(r.note) } : {}),
        }))
      : [];
    const current = getAssessment(req.params.reqId);
    const saved = await putAssessment({
      reqId: req.params.reqId,
      status: body.status ?? current.status,
      notes: body.notes ?? current.notes,
      refs,
      verified: body.verified ?? current.verified,
      seededBy: 'human',
      updatedAt: new Date().toISOString(),
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});
