import { realpathSync } from 'node:fs';
import path from 'node:path';

try {
  process.loadEnvFile('.env');
} catch {
  // .env optional; IDP_ROOT falls back to ../identity-idp
}

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.gz', '.woff',
  '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.keystore', '.p12', '.der',
]);

export const IDP_ROOT = realpathSync(
  process.env.IDP_ROOT ?? path.resolve(process.cwd(), '../identity-idp'),
);

/**
 * Resolve a repo-relative path safely inside IDP_ROOT.
 * Returns the absolute real path, or null if the path escapes the root,
 * doesn't exist, or is a binary file.
 */
export function resolveSafe(relPath: string): string | null {
  if (!relPath || path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) {
    return null;
  }
  if (BINARY_EXTS.has(path.extname(relPath).toLowerCase())) return null;
  const resolved = path.resolve(IDP_ROOT, relPath);
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    return null;
  }
  if (real !== IDP_ROOT && !real.startsWith(IDP_ROOT + path.sep)) return null;
  return real;
}

export function languageForPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  const base = path.basename(p);
  if (base === 'Gemfile' || base === 'Rakefile') return 'ruby';
  const map: Record<string, string> = {
    '.rb': 'ruby',
    '.erb': 'erb',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.json': 'json',
    '.html': 'html',
    '.scss': 'scss',
    '.css': 'css',
    '.md': 'markdown',
    '.sh': 'shellscript',
  };
  return map[ext] ?? 'text';
}
