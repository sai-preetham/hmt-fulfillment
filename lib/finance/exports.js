import { money } from './calculations.js';

export function csv(rows) {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n');
}

export function buildCaPack({ documents = [], bankTransactions = [], items = [], dashboard = {} }) {
  const sales = [['Invoice number', 'Date', 'Currency', 'Taxable value', 'GST', 'Total', 'Status'], ...documents.filter(doc => ['sales_invoice', 'credit_note'].includes(doc.document_type)).map(doc => [doc.document_number, doc.document_date, doc.currency, money(doc.subtotal), money(doc.tax_amount), money(doc.total_amount), doc.status])];
  const purchases = [['Reference', 'Vendor', 'Date', 'Currency', 'Taxable value', 'GST', 'TDS', 'Total', 'Status'], ...documents.filter(doc => ['purchase_bill', 'expense', 'payroll', 'reimbursement'].includes(doc.document_type)).map(doc => [doc.document_number, doc.vendors?.name || '', doc.document_date, doc.currency, money(doc.subtotal), money(doc.tax_amount), money(doc.tds_amount), money(doc.total_amount), doc.status])];
  const bank = [['Date', 'Description', 'Debit', 'Credit', 'Currency', 'Status'], ...bankTransactions.map(row => [row.transaction_date, row.description, money(row.debit), money(row.credit), row.currency, row.status])];
  const inventory = [['SKU', 'Product', 'Average cost', 'Available', 'Reserved', 'Inventory value'], ...items.map(item => { const available = item.ledger_available ?? (item.stock_balances || []).reduce((sum, row) => sum + Number(row.available || 0), 0); const reserved = (item.stock_balances || []).reduce((sum, row) => sum + Number(row.reserved || 0), 0); return [item.sku, item.product_name, money(item.average_cost), available, reserved, money(available * Number(item.average_cost || 0))]; })];
  const pnl = [['Metric', 'Amount (INR)'], ['Revenue', money(dashboard.revenue)], ['Expenses', money(dashboard.expenses)], ['Management P&L', money(dashboard.grossMargin)], ['Payables', money(dashboard.payables)], ['Cash movement', money(dashboard.cash)]];
  return { sales, purchases, bank, inventory, pnl };
}
