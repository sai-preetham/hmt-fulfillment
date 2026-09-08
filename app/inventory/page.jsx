import { AppShell } from '@/components/app-shell';
import { FinanceWorkspace } from '@/components/finance-workspace';
import { financeOverview } from '@/lib/finance/data';

export default async function InventoryPage() {
  const overview = await financeOverview();
  return <AppShell><header className="pageHeader"><div><p className="eyebrow">Inventory</p><h1>Stock and valuation</h1><p className="muted">Movement-ledger inventory, lots, replenishment controls, weighted-average cost, and order-linked COGS.</p></div></header><FinanceWorkspace overview={overview} section="inventory" /></AppShell>;
}
