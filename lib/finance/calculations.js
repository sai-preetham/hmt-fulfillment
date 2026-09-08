export function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

export function bankFingerprint({ transaction_date, value_date, description, debit, credit, bank_reference }) {
  return [transaction_date || '', value_date || '', normalize(description), money(debit), money(credit), normalize(bank_reference)].join('|');
}

export function documentTotals(lines = [], exchangeRate = 1, tdsAmount = 0) {
  const subtotal = money(lines.reduce((sum, line) => sum + money(line.quantity || 1) * money(line.unit_price), 0));
  const taxAmount = money(lines.reduce((sum, line) => sum + money(line.tax_amount ?? (money(line.quantity || 1) * money(line.unit_price) * money(line.tax_rate) / 100)), 0));
  const totalAmount = money(subtotal + taxAmount - money(tdsAmount));
  return { subtotal, tax_amount: taxAmount, tds_amount: money(tdsAmount), total_amount: totalAmount, base_total_amount: money(totalAmount * Number(exchangeRate || 1)) };
}

export function isBalanced(lines = []) {
  return money(lines.reduce((sum, line) => sum + money(line.debit), 0)) === money(lines.reduce((sum, line) => sum + money(line.credit), 0));
}

export function bomRequirements(lines = [], buildQuantity, basis = 1) {
  const multiplier = Number(buildQuantity) / Number(basis || 1);
  return lines.map(line => ({ ...line, required_quantity: money(Number(line.quantity) * multiplier * (1 + Number(line.scrap_percent || 0) / 100)) }));
}

export function weightedAverage({ currentQuantity = 0, currentCost = 0, receivedQuantity = 0, receivedUnitCost = 0 }) {
  const quantity = Number(currentQuantity) + Number(receivedQuantity);
  if (quantity <= 0) return 0;
  return money((Number(currentQuantity) * Number(currentCost) + Number(receivedQuantity) * Number(receivedUnitCost)) / quantity);
}

export function nextWorkOrderNumber(sequence) { return `WO-${String(sequence).padStart(6, '0')}`; }
export function nextClaimNumber(sequence) { return `RC-${String(sequence).padStart(6, '0')}`; }

function normalize(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
