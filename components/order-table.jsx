import Link from 'next/link';
import { Search } from 'lucide-react';
import { formatCurrency } from '@/lib/crm/data';
import { STATUS_FILTERS } from '@/lib/crm/constants';
import { OrderContents } from './order-contents';
import { QuickBookButton } from './quick-book-button';
import { StatusPill } from './status-pill';

export function OrderFilters({ query = '', status = '', source = '', action = '/orders', showStatus = true, showSource = true, hiddenFields = {} }) {
  return (
    <form className="filters" action={action}>
      {Object.entries(hiddenFields).map(([name, value]) => <input type="hidden" name={name} value={value} key={name} />)}
      <label>
        <span>Search</span>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ left: 10, position: 'absolute', top: 11, color: '#667085' }} />
          <input name="q" defaultValue={query} placeholder="Name, phone, order, AWB" style={{ paddingLeft: 32 }} />
        </div>
      </label>
      {showStatus ? (
      <label>
        <span>Status</span>
        <select name="status" defaultValue={status}>
          <option value="">All statuses</option>
          {STATUS_FILTERS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      ) : null}
      {showSource ? (
      <label>
        <span>Source</span>
        <select name="source" defaultValue={source}>
          <option value="">All sources</option>
          <option value="wix">Wix</option>
          <option value="amazon">Amazon</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      ) : null}
      <label>
        <span>&nbsp;</span>
        <button type="submit">Apply</button>
      </label>
    </form>
  );
}

export function OrderTable({ orders, showQuickBook = false }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Product</th>
            <th>Wix delivery</th>
            <th>Value</th>
            <th>Wix</th>
            <th>Status</th>
            <th>Tracking</th>
            <th>Operator</th>
            {showQuickBook ? <th>Quick book</th> : null}
          </tr>
        </thead>
        <tbody>
          {orders.map(order => (
            <tr key={order.id}>
              <td>
                <Link href={`/orders/${order.id}`}><strong>{order.order_number || order.external_order_id}</strong></Link>
                <span className="subtle">{order.source.toUpperCase()} · {order.external_order_id}</span>
                <span className="subtle">{order.order_date ? new Date(order.order_date).toLocaleDateString('en-IN') : ''}</span>
              </td>
              <td>
                <strong>{order.customer_name}</strong>
                <span className="subtle">{order.phone}</span>
                <span className="subtle">{order.email}</span>
                <span className="subtle">{[order.city, order.state, order.pincode].filter(Boolean).join(', ')}</span>
              </td>
              <td>
                <OrderContents order={order} compact />
                {order.bike_model ? <span className="subtle">{order.bike_model}</span> : null}
              </td>
              <td>
                <strong>{order.selected_shipping_title || 'Not provided'}</strong>
                {order.shipping_amount ? <span className="subtle">Shipping: {formatCurrency(order.shipping_amount, order.currency)}</span> : null}
              </td>
              <td>
                {formatCurrency(order.order_value, order.currency)}
                <span className="subtle"><StatusPill value={order.payment_status} /></span>
              </td>
              <td>
                <div className="statusStack">
                  <StatusPill value={order.fulfillment_status || 'not_fulfilled'} />
                  {order.wix_fulfillment_status ? <StatusPill value={order.wix_fulfillment_status} /> : null}
                </div>
                {order.wix_fulfillment_error ? <span className="subtle dangerText">{order.wix_fulfillment_error}</span> : null}
              </td>
              <td>
                <div className="statusStack">
                  <StatusPill value={order.internal_status} />
                  <StatusPill value={order.installation_status} />
                  <StatusPill value={order.feedback_status} />
                </div>
              </td>
              <td>
                <div className="statusStack">
                  <StatusPill value={order.shipment_status || 'not_booked'} />
                  <span className="subtle">{order.courier ? `Courier: ${order.courier}` : 'No courier'}</span>
                  <span className="subtle">{order.awb_number ? `AWB: ${order.awb_number}` : 'No AWB'}</span>
                  {order.tracking_url
                    ? <a className="subtle" href={order.tracking_url} target="_blank" rel="noreferrer">Open live tracking</a>
                    : <span className="subtle">Tracking link unavailable</span>}
                  <Link className="subtle" href={`/orders/${order.id}`}>Manage shipment</Link>
                </div>
              </td>
              <td>
                {order.assigned_operator || '-'}
                <span className="subtle">{(order.tags || []).join(', ')}</span>
              </td>
              {showQuickBook ? <td><QuickBookButton order={order} /></td> : null}
            </tr>
          ))}
          {!orders.length && (
            <tr>
              <td colSpan={showQuickBook ? 10 : 9} className="empty">No matching orders.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
