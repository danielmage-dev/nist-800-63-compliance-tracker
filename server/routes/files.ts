import { Router } from 'express';
import { statSync, readFileSync } from 'node:fs';
import { resolveSafe, languageForPath, IDP_ROOT } from '../lib/safePath.ts';

export const filesRouter = Router();

const MAX_BYTES = 1024 * 1024;

filesRouter.get('/file', (req, res) => {
  const relPath = String(req.query.path ?? '');
  const abs = resolveSafe(relPath);
  if (!abs) return res.status(404).json({ error: 'File not found' });
  const stat = statSync(abs);
  if (!stat.isFile() || stat.size > MAX_BYTES) {
    return res.status(404).json({ error: 'File not found' });
  }
  const content = readFileSync(abs, 'utf8');
  res.json({
    path: relPath,
    absPath: abs,
    language: languageForPath(abs),
    lineCount: content.split('\n').length,
    content,
  });
});

filesRouter.get('/idp-root', (_req, res) => {
  res.json({ root: IDP_ROOT });
});
