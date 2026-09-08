import { AppShell } from '@/components/app-shell';
import { PdfPrintDock } from '@/components/pdf-print-dock';

export default function PrintPage() {
  return <AppShell>
    <header className="pageHeader">
      <div>
        <p className="eyebrow">Label printer</p>
        <h1>Print a PDF</h1>
        <p className="muted">Upload a PDF to print it on the 10 × 15 cm label printer.</p>
      </div>
    </header>
    <section className="panel printUploadPanel"><div className="panelBody"><PdfPrintDock embedded /></div></section>
  </AppShell>;
}
