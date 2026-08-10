import { useState } from 'react';
import { api } from '../../api/client';
import type { FileRef } from '../../types';

export default function RefEditor({ onAdd }: { onAdd: (ref: FileRef) => void }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [lines, setLines] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    const trimmed = path.trim();
    if (!trimmed) return;
    try {
      await api.file(trimmed); // existence check inside IDP_ROOT
    } catch {
      setError('File not found in identity-idp');
      return;
    }
    const m = lines.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    onAdd({
      path: trimmed,
      ...(m ? { startLine: Number(m[1]) } : {}),
      ...(m?.[2] ? { endLine: Number(m[2]) } : {}),
    });
    setPath('');
    setLines('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="ref-add-btn" onClick={() => setOpen(true)}>
        + Add file mapping
      </button>
    );
  }
  return (
    <div className="ref-editor">
      <input
        className="ref-input-path"
        placeholder="app/services/rate_limiter.rb"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        autoFocus
      />
      <input
        className="ref-input-lines"
        placeholder="lines e.g. 218-240"
        value={lines}
        onChange={(e) => setLines(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button onClick={submit}>Add</button>
      <button onClick={() => setOpen(false)}>Cancel</button>
      {error && <span className="ref-error">{error}</span>}
    </div>
  );
}
