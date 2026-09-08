import { AppShell } from '@/components/app-shell';
import { FinanceWorkspace } from '@/components/finance-workspace';
import { financeOverview } from '@/lib/finance/data';

export default async function FinancePage() {
  const overview = await financeOverview();
  return <AppShell><header className="pageHeader"><div><p className="eyebrow">Finance</p><h1>Financial command center</h1><p className="muted">Accrual P&amp;L, bank reconciliation, payables, employee reimbursements, GST/TDS evidence, and CA-ready source records.</p></div></header><FinanceWorkspace overview={overview} /></AppShell>;
}
