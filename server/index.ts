import express from 'express';
import path from 'node:path';
import { specRouter } from './routes/spec.ts';
import { assessmentsRouter } from './routes/assessments.ts';
import { filesRouter } from './routes/files.ts';
import { IDP_ROOT } from './lib/safePath.ts';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api/spec', specRouter);
app.use('/api', assessmentsRouter);
app.use('/api', filesRouter);
app.use('/spec-assets', express.static(path.join(process.cwd(), 'data/spec/assets')));

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal error' });
});

const PORT = 3001;
// Bind loopback only: /api/file serves files out of IDP_ROOT, which must not be
// reachable from the local network.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`API on http://localhost:${PORT}  (IDP_ROOT=${IDP_ROOT})`);
});
