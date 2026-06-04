const ordersBody = document.querySelector('#ordersBody');
const ordersStatusText = document.querySelector('#ordersStatusText');
const refreshButton = document.querySelector('#refreshButton');
const syncButton = document.querySelector('#syncButton');
const internationalExportButton = document.querySelector('#internationalExportButton');
const drawer = document.querySelector('#drawer');
const drawerClose = document.querySelector('#drawerClose');
const drawerTitle = document.querySelector('#drawerTitle');
const drawerBody = document.querySelector('#drawerBody');

let currentQueue = 'needs_shipping';
let currentOrders = [];
const rateCache = new Map();

document.querySelectorAll('[data-queue]').forEach(button => {
  button.addEventListener('click', async () => {
    currentQueue = button.dataset.queue;
    document.querySelectorAll('[data-queue]').forEach(tab => tab.classList.toggle('active', tab === button));
    await loadDashboard();
  });
});

refreshButton.addEventListener('click', loadDashboard);
internationalExportButton.addEventListener('click', () => {
  window.location.href = '/api/international/export';
});
syncButton.addEventListener('click', async () => {
  syncButton.disabled = true;
  syncButton.textContent = 'Syncing...';
  try {
    await postJson('/api/sync/wix-orders', {});
    await loadDashboard();
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = 'Sync Wix';
  }
});

drawerClose.addEventListener('click', closeDrawer);
drawer.addEventListener('click', event => {
  if (event.target === drawer) closeDrawer();
});

ordersBody.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  const row = event.target.closest('tr[data-order-id]');
  if (!row) return;
  const orderId = row.dataset.orderId;
  const order = currentOrders.find(item => item.id === orderId);

  if (!button) {
    await openDrawer(orderId);
    return;
  }

  event.stopPropagation();
  await runAction(button, order);
});

async function loadDashboard() {
  ordersStatusText.textContent = 'Loading...';
  const response = await fetch(`/api/dashboard/orders?queue=${encodeURIComponent(currentQueue)}&limit=100`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load dashboard');

  currentOrders = data.orders || [];
  ordersBody.innerHTML = currentOrders.length
    ? currentOrders.map(renderOrderRow).join('')
    : '<tr><td colspan="7" class="empty">No orders in this queue.</td></tr>';
  renderSummary(data.summary || {}, data.sync || {});
  ordersStatusText.textContent = `${currentOrders.length} order${currentOrders.length === 1 ? '' : 's'}`;
  loadRatesForOrders(currentOrders, currentQueue).catch(error => {
    ordersStatusText.textContent = error.message;
  });
}

async function runAction(button, order) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Working...';
  try {
    if (button.dataset.action === 'copy-awb') {
      await navigator.clipboard.writeText(order.shipment_waybill || '');
      button.textContent = 'Copied';
      return;
    }
    if (button.dataset.action === 'book') {
      await postJson(`/api/orders/${encodeURIComponent(order.id)}/book`, {
        shippingMode: button.dataset.shippingMode,
        internationalService: button.dataset.internationalService || ''
      });
    }
    if (button.dataset.action === 'sync-wix') {
      await postJson(`/api/orders/${encodeURIComponent(order.id)}/sync-wix-fulfillment`, {});
    }
    if (button.dataset.action === 'label') {
      window.open(order.shipment_label_url, '_blank', 'noopener');
    }
    if (button.dataset.action === 'international-export') {
      window.location.href = `/api/international/export?orderId=${encodeURIComponent(order.id)}`;
    }
    await loadDashboard();
  } catch (error) {
    button.textContent = original;
    ordersStatusText.textContent = error.message;
  } finally {
    if (button.textContent !== 'Copied') {
      button.disabled = false;
      button.textContent = original;
    } else {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 900);
    }
  }
}

async function openDrawer(orderId) {
  const detail = await fetchOrderDetail(orderId);
  drawerTitle.textContent = `Order ${detail.order.order_number || detail.order.wix_order_id}`;
  drawerBody.innerHTML = renderDrawer(detail);
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}

async function fetchOrderDetail(orderId) {
  const response = await fetch(`/api/dashboard/orders/${encodeURIComponent(orderId)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load order details');
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function renderSummary(summary, sync) {
  document.querySelector('#needsBookingCount').textContent = summary.needsBooking || 0;
  document.querySelector('#bookedTodayCount').textContent = summary.bookedToday || 0;
  document.querySelector('#failedCount').textContent = summary.failed || 0;
  document.querySelector('#wixFailedCount').textContent = summary.wixSyncFailed || 0;
  document.querySelector('#lastSyncText').textContent = sync.lastFinishedAt
    ? `${formatDate(sync.lastFinishedAt)} (${sync.lastPersisted || 0})`
    : sync.running
      ? 'Running'
      : 'Not run';
}

function renderOrderRow(order) {
  const raw = order.raw_order || {};
  const destination = raw?.shippingInfo?.logistics?.shippingDestination || {};
  const address = destination.address || {};
  const customerName = order.customers?.name || contactName(destination.contactDetails) || order.customers?.email || 'Customer';
  const awb = order.shipment_waybill || '';

  return `
    <tr data-order-id="${escapeHtml(order.id)}">
      <td>
        <strong>${escapeHtml(order.order_number || '')}</strong>
        <span class="subtle">${escapeHtml(customerName)}</span>
        <span class="subtle">${escapeHtml(order.customers?.phone || '')}</span>
      </td>
      <td>
        ${escapeHtml([address.city, address.postalCode, address.country].filter(Boolean).join(', '))}
        <span class="subtle">${escapeHtml(address.addressLine || formatStreetAddress(address.streetAddress) || '')}</span>
      </td>
      <td>${escapeHtml(summarizeProducts(raw.lineItems || []))}</td>
      <td>
        <span>${escapeHtml(order.selected_shipping_title || raw?.shippingInfo?.title || '')}</span>
        <span class="subtle">Charged: ${escapeHtml(formatMoney(order.shipping_amount, order.currency))}</span>
        ${renderRateCell(order)}
      </td>
      <td>${renderShipmentCell(order, awb)}</td>
      <td>${renderWixCell(order)}</td>
      <td>${renderActions(order)}</td>
    </tr>
  `;
}

async function loadRatesForOrders(orders, queue) {
  const rateableOrders = orders.filter(order => {
    const address = order.raw_order?.shippingInfo?.logistics?.shippingDestination?.address;
    return address?.country === 'IN' && address?.postalCode;
  });

  await Promise.all(
    rateableOrders.map(async order => {
      const address = order.raw_order.shippingInfo.logistics.shippingDestination.address;
      const weight = calculateWeightGrams(order.raw_order);
      const [express, surface] = await Promise.all([
        fetchRate(address.postalCode, weight, 'E'),
        fetchRate(address.postalCode, weight, 'S')
      ]);
      rateCache.set(order.id, { express, surface });
    })
  );

  if (queue === currentQueue) {
    ordersBody.innerHTML = currentOrders.length
      ? currentOrders.map(renderOrderRow).join('')
      : '<tr><td colspan="7" class="empty">No orders in this queue.</td></tr>';
  }
}

async function fetchRate(pin, weight, mode) {
  const key = `${pin}:${weight}:${mode}`;
  if (rateCache.has(key)) return rateCache.get(key);

  const response = await fetch(`/api/delhivery/rate?pin=${encodeURIComponent(pin)}&weight=${weight}&mode=${mode}`);
  const data = await response.json();
  const result = response.ok ? (Array.isArray(data) ? data[0] : data) : { error: data.error || 'Rate unavailable' };
  rateCache.set(key, result);
  return result;
}

function renderRateCell(order) {
  const raw = order.raw_order || {};
  const address = raw?.shippingInfo?.logistics?.shippingDestination?.address || {};
  if (address.country && address.country !== 'IN') return '';
  if (!address.postalCode) return '<span class="subtle">Expected: pincode missing</span>';

  const rates = rateCache.get(order.id);
  if (!rates) return '<span class="subtle">Expected: loading...</span>';

  return `
    <div class="rates">
      <span>Express: ${escapeHtml(formatRate(rates.express))}</span>
      <span>Surface: ${escapeHtml(formatRate(rates.surface))}</span>
    </div>
  `;
}

function formatRate(rate) {
  if (!rate || rate.error) return 'NA';
  const amount = rate.total_amount ?? rate.gross_amount;
  const zone = rate.zone ? ` Z${rate.zone}` : '';
  return amount ? `INR ${Number(amount).toLocaleString()}${zone}` : 'NA';
}

function calculateWeightGrams(order) {
  const totalKg = (order.lineItems || []).reduce((sum, item) => {
    const weight = Number(item?.physicalProperties?.weight || 0);
    const quantity = Number(item?.quantity || 1);
    return sum + weight * quantity;
  }, 0);
  return Math.max(1, Math.round(totalKg * 1000) || 400);
}

function renderShipmentCell(order, awb) {
  const status = order.shipment_status || 'not-booked';
  if (!awb) {
    return `<span class="pill ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
  }
  return `
    <div class="shipmentBox">
      <span class="pill booked">Booked</span>
      <strong>${escapeHtml(awb)}</strong>
      <span class="subtle">${escapeHtml([order.shipment_service_mode, order.shipment_service_code].filter(Boolean).join(' · '))}</span>
      <span class="subtle">${escapeHtml(formatDate(order.shipment_booked_at))}</span>
    </div>
  `;
}

function renderWixCell(order) {
  const status = order.wix_fulfillment_status || (order.shipment_waybill ? 'not-synced' : 'waiting');
  return `
    <span class="pill ${escapeHtml(status)}">${escapeHtml(status)}</span>
    ${order.wix_fulfillment_error ? `<span class="subtle errorText">${escapeHtml(order.wix_fulfillment_error)}</span>` : ''}
  `;
}

function renderActions(order) {
  const country = order.raw_order?.shippingInfo?.logistics?.shippingDestination?.address?.country;
  const isInternational = country && country !== 'IN';
  const awb = order.shipment_waybill;
  const wixFailed = order.wix_fulfillment_status === 'failed';
  const needsWixSync = awb && order.wix_fulfillment_status !== 'synced' && order.wix_fulfillment_status !== 'pending';

  if (awb) {
    return `
      <div class="buttonStack">
        <button type="button" data-action="copy-awb">Copy AWB</button>
        ${needsWixSync ? `<button type="button" class="secondary" data-action="sync-wix">${wixFailed ? 'Retry Wix' : 'Update Wix'}</button>` : ''}
        ${
          order.shipment_label_url
            ? '<button type="button" class="secondary" data-action="label">Print Label</button>'
            : '<button type="button" class="secondary" disabled>Label unavailable</button>'
        }
      </div>
    `;
  }

  if (isInternational) {
    return `
      <div class="buttonStack">
        <button type="button" data-action="international-export">Download Excel</button>
        <button type="button" class="secondary" data-action="book" data-international-service="Deferred Express">Mark Pending</button>
      </div>
    `;
  }

  return `
    <div class="buttonStack">
      <button type="button" data-action="book" data-shipping-mode="E">${order.shipment_status === 'failed' ? 'Retry Express' : 'Book Express'}</button>
      <button type="button" class="secondary" data-action="book" data-shipping-mode="S">Book Surface</button>
    </div>
  `;
}

function renderDrawer({ order, shipment, attempts }) {
  const raw = order.raw_order || {};
  const destination = raw?.shippingInfo?.logistics?.shippingDestination || {};
  const address = destination.address || {};
  const contact = destination.contactDetails || {};
  return `
    <section class="detailGrid">
      <div>
        <h3>Customer</h3>
        <p>${escapeHtml(contactName(contact) || order.customers?.name || '')}</p>
        <p>${escapeHtml(order.customers?.email || raw?.buyerInfo?.email || '')}</p>
        <p>${escapeHtml(order.customers?.phone || contact.phone || '')}</p>
      </div>
      <div>
        <h3>Address</h3>
        <p>${escapeHtml([address.addressLine, formatStreetAddress(address.streetAddress)].filter(Boolean).join(', '))}</p>
        <p>${escapeHtml([address.city, address.subdivision || address.subdivisionFullname, address.postalCode, address.country].filter(Boolean).join(', '))}</p>
      </div>
      <div>
        <h3>Shipment</h3>
        <p>Status: ${escapeHtml(order.shipment_status || 'not booked')}</p>
        <p>AWB: ${escapeHtml(order.shipment_waybill || '')}</p>
        <p>Service: ${escapeHtml(order.shipment_service_mode || order.shipment_service_code || '')}</p>
        <p>Label: ${shipment?.label_url ? `<a href="${escapeHtml(shipment.label_url)}" target="_blank" rel="noopener">Open label</a>` : escapeHtml(shipment?.label_error || 'Unavailable')}</p>
      </div>
      <div>
        <h3>Wix sync</h3>
        <p>Status: ${escapeHtml(order.wix_fulfillment_status || '')}</p>
        <p>Fulfillment ID: ${escapeHtml(order.wix_fulfillment_id || '')}</p>
        <p>${escapeHtml(order.wix_fulfillment_error || '')}</p>
      </div>
    </section>
    <section>
      <h3>Items</h3>
      <ul class="itemList">${(raw.lineItems || []).map(renderDrawerItem).join('')}</ul>
    </section>
    <section>
      <h3>Latest carrier response</h3>
      <pre>${escapeHtml(JSON.stringify(shipment?.carrier_response || shipment?.error || {}, null, 2))}</pre>
    </section>
    <section>
      <h3>Attempts</h3>
      <div class="attempts">${attempts.length ? attempts.map(renderAttempt).join('') : '<p class="subtle">No attempts recorded.</p>'}</div>
    </section>
  `;
}

function renderDrawerItem(item) {
  const sku = item?.physicalProperties?.sku ? ` · ${item.physicalProperties.sku}` : '';
  return `<li>${escapeHtml(item?.productName?.original || item?.name || 'Item')} x${escapeHtml(item?.quantity || 1)}${escapeHtml(sku)}</li>`;
}

function renderAttempt(attempt) {
  return `
    <div class="attempt">
      <strong>#${escapeHtml(attempt.attempt_number)} ${attempt.success ? 'Success' : 'Failed'}</strong>
      <span>${escapeHtml(formatDate(attempt.created_at))}</span>
      <span>${escapeHtml(attempt.error || '')}</span>
    </div>
  `;
}

function contactName(contact = {}) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ');
}

function formatStreetAddress(street = {}) {
  return [street.name, street.number, street.apt].filter(Boolean).join(', ');
}

function summarizeProducts(lineItems) {
  return lineItems
    .map(item => `${item?.productName?.original || item?.name || 'Item'} x${item?.quantity || 1}`)
    .join(', ');
}

function formatMoney(value, currency = 'INR') {
  if (value === null || value === undefined || value === '') return '';
  return `${currency || 'INR'} ${Number(value).toLocaleString()}`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[char];
  });
}

loadDashboard().catch(error => {
  ordersStatusText.textContent = error.message;
});
