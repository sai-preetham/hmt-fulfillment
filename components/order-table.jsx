import Link from 'next/link';
import { Search } from 'lucide-react';
import { formatCurrency } from '@/lib/crm/data';
import { STATUS_FILTERS } from '@/lib/crm/constants';
import { OrderContents } from './order-contents';
import { StatusPill } from './status-pill';

export function OrderFilters({ query = '', status = '', source = '' }) {
  return (
    <form className="filters" action="/orders">
      <label>
        <span>Search</span>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ left: 10, position: 'absolute', top: 11, color: '#667085' }} />
          <input name="q" defaultValue={query} placeholder="Name, phone, order, AWB, bike, source" style={{ paddingLeft: 32 }} />
        </div>
      </label>
      <label>
        <span>Status</span>
        <select name="status" defaultValue={status}>
          <option value="">All statuses</option>
          {STATUS_FILTERS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <label>
        <span>Source</span>
        <select name="source" defaultValue={source}>
          <option value="">All sources</option>
          <option value="wix">Wix</option>
          <option value="amazon">Amazon</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      <label>
        <span>&nbsp;</span>
        <button type="submit">Apply</button>
      </label>
    </form>
  );
}

export function OrderTable({ orders }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Product</th>
            <th>Value</th>
            <th>Status</th>
            <th>Tracking</th>
            <th>Operator</th>
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
                {formatCurrency(order.order_value, order.currency)}
                <span className="subtle"><StatusPill value={order.payment_status} /></span>
              </td>
              <td>
                <div className="statusStack">
                  <StatusPill value={order.internal_status} />
                  <StatusPill value={order.installation_status} />
                  <StatusPill value={order.feedback_status} />
                </div>
              </td>
              <td>
                <span className="subtle">{order.courier || 'No courier'}</span>
                <span className="subtle">{order.awb_number || 'No AWB'}</span>
                <span className="subtle">{order.tracking_url ? 'Tracking link set' : 'No tracking link'}</span>
              </td>
              <td>
                {order.assigned_operator || '-'}
                <span className="subtle">{(order.tags || []).join(', ')}</span>
              </td>
            </tr>
          ))}
          {!orders.length && (
            <tr>
              <td colSpan="7" className="empty">No matching orders.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
