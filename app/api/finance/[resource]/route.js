import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { approveBom, closeFinancePeriod, createBom, createFinanceDocument, createInventoryItem, createReimbursement, createVendor, createWorkOrder, financeOverview, importBankTransactions, postJournal, recordInventoryMovement, syncSalesInvoices, transitionReimbursement, transitionWorkOrder } from '@/lib/finance/data';

export async function GET(_request, { params }) {
  const { resource } = await params;
  await requirePermission(permissionFor(resource, 'GET'));
  const overview = await financeOverview();
  const key = resourceToKey(resource);
  return NextResponse.json(key ? { [key]: overview[key] } : overview);
}

export async function POST(request, { params }) {
  const { resource } = await params;
  const actor = await requirePermission(permissionFor(resource, 'POST'));
  const payload = await request.json();
  try {
    const handlers = {
      documents: () => createFinanceDocument(payload, actor),
      'sales-sync': () => syncSalesInvoices(actor),
      vendors: () => createVendor(payload, actor),
      items: () => createInventoryItem(payload, actor),
      journals: () => postJournal(payload, actor),
      'bank-imports': () => importBankTransactions(payload, actor),
      reimbursements: () => payload.id ? transitionReimbursement(payload.id, payload.action, actor) : createReimbursement(payload, actor),
      movements: () => recordInventoryMovement(payload, actor),
      boms: () => payload.action === 'approve' ? approveBom(payload.id, actor) : createBom(payload, actor),
      'work-orders': () => payload.id ? transitionWorkOrder(payload.id, payload.status, actor) : createWorkOrder(payload, actor),
      periods: () => closeFinancePeriod(payload.id, payload.action, actor)
    };
    if (!handlers[resource]) return NextResponse.json({ error: 'Unknown finance resource.' }, { status: 404 });
    return NextResponse.json({ ok: true, data: await handlers[resource]() }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Finance operation failed.' }, { status: 400 });
  }
}

function resourceToKey(resource) {
  return { dashboard: null, documents: 'documents', inventory: 'items', boms: 'boms', 'work-orders': 'workOrders', bank: 'bankTransactions', reimbursements: 'claims' }[resource];
}
function permissionFor(resource, method) {
  if (['inventory', 'movements'].includes(resource)) return `inventory.${method === 'GET' ? 'view' : 'edit'}`;
  if (['boms', 'work-orders', 'manufacturing'].includes(resource)) return `manufacturing.${method === 'GET' ? 'view' : 'edit'}`;
  return `finance.${method === 'GET' ? 'view' : 'edit'}`;
}
