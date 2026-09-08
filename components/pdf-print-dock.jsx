'use client';

import { Printer, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

export function PdfPrintDock({ embedded = false }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!file) return setMessage('Choose a PDF first.');
    setBusy(true);
    setMessage('');
    const data = new FormData();
    data.set('file', file);
    try {
      const response = await fetch('/api/crm/print', { method: 'POST', body: data });
      const result = await response.json().catch(() => ({}));
      setMessage(result.message || result.error || (response.ok ? 'Print job queued.' : 'Print failed.'));
      if (response.ok) {
        setFile(null);
        if (inputRef.current) inputRef.current.value = '';
      }
    } catch {
      setMessage('Could not contact the print service.');
    } finally {
      setBusy(false);
    }
  }

  return <aside className={`pdfPrintDock${embedded ? ' embedded' : ''}`} aria-label="Print a PDF label">
    <div className="pdfPrintDockTitle"><Printer size={18} aria-hidden="true" /><div><strong>Print label</strong><span>10 × 15 cm</span></div></div>
    <form onSubmit={submit}>
      <label className="pdfUpload">
        <Upload size={16} aria-hidden="true" />
        <span>{file ? file.name : 'Choose PDF'}</span>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={event => { setFile(event.target.files?.[0] || null); setMessage(''); }} />
      </label>
      <button type="submit" disabled={busy || !file}>{busy ? 'Sending…' : 'Print PDF'}</button>
    </form>
    {message ? <small className={message.includes('Queued') ? 'muted' : 'dangerText'}>{message}</small> : <small className="muted">PDF only · up to 20 MB</small>}
  </aside>;
}
