import { AppShell } from '@/components/app-shell';
import { FinanceWorkspace } from '@/components/finance-workspace';
import { financeOverview } from '@/lib/finance/data';

export default async function ManufacturingPage() {
  const overview = await financeOverview();
  return <AppShell><header className="pageHeader"><div><p className="eyebrow">Manufacturing</p><h1>BOM and work orders</h1><p className="muted">Approved multi-level BOM revisions, component requirements, staged work orders, quality checks, and lot lineage.</p></div></header><FinanceWorkspace overview={overview} section="manufacturing" /></AppShell>;
}
