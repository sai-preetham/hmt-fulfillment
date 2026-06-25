import { formatCurrency } from '@/lib/crm/data';

export function OrderContents({ order, items, compact = false }) {
  const contents = normalizedContents(order, items);

  if (compact) {
    return (
      <div className="orderContents compact">
        {contents.map(item => (
          <div className="orderContentLine" key={item.id}>
            <span className="orderContentName">{item.name}</span>
            <span className="subtle">
              Qty {item.quantity}
              {item.sku ? ` · ${item.sku}` : ''}
              {item.amount ? ` · ${formatCurrency(item.amount, order.currency)}` : ''}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="tableWrap">
      <table className="contentsTable">
        <thead>
          <tr>
            <th>Item</th>
            <th>SKU</th>
            <th>HSN</th>
            <th>Qty</th>
            <th>Line value</th>
          </tr>
        </thead>
        <tbody>
          {contents.map(item => (
            <tr key={item.id}>
              <td>
                <strong>{item.name}</strong>
              </td>
              <td>{item.sku || '-'}</td>
              <td>{item.hsn || '-'}</td>
              <td>{item.quantity}</td>
              <td>{item.amount ? formatCurrency(item.amount, order.currency) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function normalizedContents(order = {}, items = order.items || []) {
  const sourceItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (sourceItems.length) {
    return sourceItems.map((item, index) => ({
      id: item.id || `${item.product_name || 'item'}-${index}`,
      name: item.product_name || order.product_variant || order.bike_model || 'Product',
      sku: item.sku || '',
      hsn: item.hsn_code || '',
      quantity: Number(item.quantity || 1),
      amount: Number(item.total_price || item.item_price || 0)
    }));
  }

  return [{
    id: `${order.id || 'order'}-summary-item`,
    name: order.product_variant || order.bike_model || 'Product',
    sku: '',
    hsn: '',
    quantity: Number(order.quantity || 1),
    amount: Number(order.order_value || 0)
  }];
}
