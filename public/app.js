const ordersBody = document.querySelector('#ordersBody');
const ordersStatusText = document.querySelector('#ordersStatusText');
const refreshButton = document.querySelector('#refreshButton');
const syncButton = document.querySelector('#syncButton');
const syncFulfilledButton = document.querySelector('#syncFulfilledButton');
const syncCancelledButton = document.querySelector('#syncCancelledButton');
const pullTrackingButton = document.querySelector('#pullTrackingButton');
const internationalExportButton = document.querySelector('#internationalExportButton');
const drawer = document.querySelector('#drawer');
const drawerClose = document.querySelector('#drawerClose');
const drawerTitle = document.querySelector('#drawerTitle');
const drawerBody = document.querySelector('#drawerBody');

let currentQueue = 'needs_packing';
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

syncFulfilledButton.addEventListener('click', async () => {
  syncFulfilledButton.disabled = true;
  syncFulfilledButton.textContent = 'Checking Wix...';
  try {
    const result = await postJson('/api/sync/fulfilled-orders', {});
    if (result.skipped) {
      ordersStatusText.textContent = `Sync skipped: ${result.reason}`;
    } else {
      ordersStatusText.textContent = `Fulfilled sync done — ${result.pulled} orders pulled from Wix, ${result.persisted} updated`;
    }
    await loadDashboard();
  } catch (error) {
    ordersStatusText.textContent = `Sync error: ${error.message}`;
  } finally {
    syncFulfilledButton.disabled = false;
    syncFulfilledButton.textContent = 'Sync Fulfilled';
  }
});

syncCancelledButton.addEventListener('click', async () => {
  syncCancelledButton.disabled = true;
  syncCancelledButton.textContent = 'Checking Wix...';
  try {
    const result = await postJson('/api/sync/cancelled-orders', {});
    if (result.skipped) {
      ordersStatusText.textContent = `Sync skipped: ${result.reason}`;
    } else {
      ordersStatusText.textContent = `Cancelled sync done — ${result.pulled} orders pulled, ${result.persisted} updated`;
    }
    await loadDashboard();
  } catch (error) {
    ordersStatusText.textContent = `Sync error: ${error.message}`;
  } finally {
    syncCancelledButton.disabled = false;
    syncCancelledButton.textContent = 'Sync Cancelled';
  }
});

pullTrackingButton.addEventListener('click', async () => {
  pullTrackingButton.disabled = true;
  pullTrackingButton.textContent = 'Pulling...';
  try {
    const result = await postJson('/api/tracking/sync', {});
    const tracking = result.tracking || {};
    const polled = tracking.lastPolled ?? 0;
    const updated = tracking.lastUpdated ?? 0;
    const events = tracking.lastEvents ?? 0;
    if (tracking.skipped) {
      ordersStatusText.textContent = `Tracking skipped: ${tracking.reason || 'disabled'}`;
    } else {
      ordersStatusText.textContent = `Tracking done — ${polled} checked, ${updated} updated, ${events} new events`;
    }
    await loadDashboard();
  } catch (error) {
    ordersStatusText.textContent = `Tracking error: ${error.message}`;
  } finally {
    pullTrackingButton.disabled = false;
    pullTrackingButton.textContent = 'Pull Tracking';
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
      const refreshFromWix = window.confirm(
        'Check Wix first? If this order is already fulfilled on Wix, this will update the local order and skip calling Wix again.'
      );
      const result = await postJson(`/api/orders/${encodeURIComponent(order.id)}/sync-wix-fulfillment`, {
        refreshFromWix
      });
      if (result.skipped && result.reason === 'already-fulfilled-on-wix') {
        ordersStatusText.textContent = 'Updated from Wix: order is already fulfilled, so Wix was not called again.';
      }
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
  setupDrawerListeners(detail);
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
  document.querySelector('#needsPackingCount').textContent = summary.needsPacking || 0;
  document.querySelector('#needsBookingCount').textContent = summary.needsBooking || 0;
  document.querySelector('#readyPickupCount').textContent = summary.readyForPickup || 0;
  document.querySelector('#inTransitCount').textContent = summary.inTransit || 0;
  document.querySelector('#needsCallCount').textContent = summary.needsCall || 0;
  document.querySelector('#completedCount').textContent = summary.completed || 0;
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
      <span class="pill booked">${escapeHtml(status)}</span>
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

  const packStatus = order.pick_pack_tasks?.[0]?.status || 'open';

  // Packing Actions
  if (packStatus !== 'packed' && !awb && !isInternational) {
    return `
      <div class="buttonStack">
        <button type="button" class="pack-action">Verify & Pack</button>
      </div>
    `;
  }

  // Booking Actions
  if (packStatus === 'packed' && !awb && !isInternational) {
    return `
      <div class="buttonStack">
        <button type="button" data-action="book" data-shipping-mode="E">${order.shipment_status === 'failed' ? 'Retry Express' : 'Book Express'}</button>
        <button type="button" class="secondary" data-action="book" data-shipping-mode="S">Book Surface</button>
      </div>
    `;
  }

  // International Actions
  if (isInternational && !awb) {
    return `
      <div class="buttonStack">
        <button type="button" data-action="international-export">Download Excel</button>
        <button type="button" class="secondary" data-action="book" data-international-service="Deferred Express">Mark Pending</button>
      </div>
    `;
  }

  // Call Actions
  if (order.shipment_status === 'delivered' && !isBuyerCallComplete(order.buyer_call_status)) {
    return `
      <div class="buttonStack">
        <button type="button" class="call-action">Call Buyer</button>
      </div>
    `;
  }

  // General Post-Booking Actions
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

  return `<span class="subtle">No actions</span>`;
}

function renderDrawer({ order, shipment, attempts }) {
  const raw = order.raw_order || {};
  const destination = raw?.shippingInfo?.logistics?.shippingDestination || {};
  const address = destination.address || {};
  const contact = destination.contactDetails || {};

  const packStatus = order.pick_pack_tasks?.[0]?.status || 'open';
  const hasAwb = Boolean(order.shipment_waybill);
  const country = address.country || 'IN';
  const isInternational = country !== 'IN';

  const isDelivered = order.shipment_status === 'delivered';
  const isCancelled = order.status === 'CANCELED';
  const isWixFulfilled = order.fulfillment_status === 'FULFILLED';
  const canMarkFulfilled = !hasAwb && !isWixFulfilled && !isCancelled;

  return `
    <div class="drawerActions" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
      <button type="button" id="btnRefreshWix" class="secondary">↻ Refresh from Wix</button>
      ${canMarkFulfilled ? `<button type="button" id="btnMarkFulfilled" class="secondary">✓ Mark as Fulfilled</button>` : ''}
    </div>

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
        <p>Status: <span class="pill">${escapeHtml(order.shipment_status || 'not booked')}</span></p>
        <p>AWB: <strong>${escapeHtml(order.shipment_waybill || 'N/A')}</strong></p>
        <p>Service: ${escapeHtml(order.shipment_service_mode || order.shipment_service_code || 'N/A')}</p>
        <p>Label: ${shipmentLabelUrl(shipment) ? `<a href="${escapeHtml(shipmentLabelUrl(shipment))}" target="_blank" rel="noopener">Open label</a>` : escapeHtml(shipmentLabelError(shipment) || 'Unavailable')}</p>
      </div>
      <div>
        <h3>Fulfillment & Calls</h3>
        <p>Wix Status: <span class="pill">${escapeHtml(order.wix_fulfillment_status || 'waiting')}</span></p>
        <p>Call Status: <span class="pill ${isBuyerCallComplete(order.buyer_call_status) ? 'booked' : 'pending'}">${escapeHtml(formatBuyerCallStatus(order.buyer_call_status))}</span></p>
        ${order.buyer_called_at ? `<p class="subtle">Called: ${escapeHtml(formatDate(order.buyer_called_at))}</p>` : ''}
        ${order.buyer_call_notes ? `<p class="subtle">Notes: "${escapeHtml(order.buyer_call_notes)}"</p>` : ''}
      </div>
    </section>

    <!-- 1. Packing Section -->
    ${packStatus !== 'packed' && !hasAwb && !isInternational ? `
      <section>
        <h3>Packing Verification Checklist</h3>
        <p class="subtle" style="margin-bottom: 12px;">Confirm all items are picked and present before packing:</p>
        <ul class="itemList">
          ${(raw.lineItems || []).map((item, idx) => `
            <li>
              <label class="pack-check" id="lbl_chk_${idx}">
                <input type="checkbox" class="pack-item-checkbox" data-index="${idx}" />
                <span>${escapeHtml(item?.productName?.original || item?.name || 'Item')} x${escapeHtml(item?.quantity || 1)}</span>
              </label>
              <span class="subtle">${escapeHtml(item?.physicalProperties?.sku || 'No SKU')}</span>
            </li>
          `).join('')}
        </ul>
        <button type="button" id="btnMarkPacked" class="btn-pack-all" disabled>Complete Packing & Move to Booking</button>
      </section>
    ` : ''}

    <!-- 2. Manual Shipment Status Section -->
    ${hasAwb && shipment ? `
      <section class="simulation-widget">
        <h3>Manual Shipment Status</h3>
        <div class="call-log-form">
          <div>
            <label for="manualShipmentStatus">Shipment status</label>
            <select id="manualShipmentStatus">
              ${renderShipmentStatusOptions(order.shipment_status || shipment.status)}
            </select>
          </div>
          <button type="button" id="btnSaveShipmentStatus" class="secondary" style="width:100%;">Update Shipment Status</button>
        </div>
        <div style="margin-top:12px;">
          <button type="button" id="btnRefreshTracking" class="secondary" style="width:100%;">↻ Refresh from Delhivery now</button>
          <p id="trackingRefreshStatus" class="subtle" style="margin-top:6px;"></p>
        </div>
      </section>
    ` : ''}

    <!-- 3. Buyer Call Form Section -->
    ${isDelivered && !isBuyerCallComplete(order.buyer_call_status) ? `
      <section>
        <h3>Buyer Verification Call Log</h3>
        <form class="call-log-form" onsubmit="event.preventDefault();">
          <div>
            <label for="callStatusSelect">Call Outcome</label>
            <select id="callStatusSelect">
              <option value="answered_confirmed">Answered - Confirmed Delivery</option>
              <option value="no_answer">Busy / No Answer (Retry Later)</option>
              <option value="wrong_number">Wrong Phone Number</option>
              <option value="rejected">Rejected / Returning Package</option>
            </select>
          </div>
          <div>
            <label for="callNotesText">Call Notes / Customer Feedback</label>
            <textarea id="callNotesText" placeholder="Enter details about delivery status or buyer feedback..."></textarea>
          </div>
          <button type="button" id="btnSubmitCall" style="width: 100%;">Save Call Details & Finalize</button>
        </form>
      </section>
    ` : ''}

    <section>
      <h3>Items Ordered</h3>
      <ul class="itemList">${(raw.lineItems || []).map(renderDrawerItem).join('')}</ul>
    </section>
    <section>
      <h3>Latest Carrier Response</h3>
      <pre>${escapeHtml(JSON.stringify(shipment?.carrier_response || shipment?.error || {}, null, 2))}</pre>
    </section>
    <section>
      <h3>Fulfillment Action History</h3>
      <div class="attempts">${attempts.length ? attempts.map(renderAttempt).join('') : '<p class="subtle">No actions logged yet.</p>'}</div>
    </section>
  `;
}

function setupDrawerListeners(detail) {
  const { order, shipment } = detail;

  // 1. Packing Checklist logic
  const checkBoxes = drawer.querySelectorAll('.pack-item-checkbox');
  const btnMarkPacked = drawer.querySelector('#btnMarkPacked');
  if (checkBoxes.length && btnMarkPacked) {
    checkBoxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const label = drawer.querySelector(`#lbl_chk_${cb.dataset.index}`);
        if (label) label.classList.toggle('checked', cb.checked);

        const allChecked = Array.from(checkBoxes).every(c => c.checked);
        btnMarkPacked.disabled = !allChecked;
      });
    });

    btnMarkPacked.addEventListener('click', async () => {
      btnMarkPacked.disabled = true;
      btnMarkPacked.textContent = 'Packing...';
      try {
        await postJson(`/api/orders/${encodeURIComponent(order.id)}/pack`, {});
        closeDrawer();
        await loadDashboard();
      } catch (error) {
        btnMarkPacked.textContent = 'Error';
        alert(error.message);
        btnMarkPacked.disabled = false;
      }
    });
  }

  // 2. Manual shipment status update
  const btnSaveShipmentStatus = drawer.querySelector('#btnSaveShipmentStatus');
  const manualShipmentStatus = drawer.querySelector('#manualShipmentStatus');
  if (btnSaveShipmentStatus && manualShipmentStatus && shipment) {
    btnSaveShipmentStatus.addEventListener('click', async () => {
      const status = manualShipmentStatus.value;
      if (!confirm(`Update shipment status to "${formatShipmentStatus(status)}"?`)) return;
      btnSaveShipmentStatus.disabled = true;
      btnSaveShipmentStatus.textContent = 'Updating...';
      try {
        await postJson(`/api/shipments/${encodeURIComponent(shipment.id)}/status`, {
          status
        });
        const fresh = await fetchOrderDetail(order.id);
        drawerTitle.textContent = `Order ${fresh.order.order_number || fresh.order.wix_order_id}`;
        drawerBody.innerHTML = renderDrawer(fresh);
        setupDrawerListeners(fresh);
        await loadDashboard();
      } catch (error) {
        btnSaveShipmentStatus.textContent = 'Update Shipment Status';
        btnSaveShipmentStatus.disabled = false;
        alert(error.message);
      }
    });
  }

  // Compatibility for older quick status buttons if present in cached markup.
  const simButtons = drawer.querySelectorAll('.btnSimStatus');
  if (simButtons.length && shipment) {
    simButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        await postJson(`/api/shipments/${encodeURIComponent(shipment.id)}/status`, {
          status: btn.dataset.status
        });
        closeDrawer();
        await loadDashboard();
      });
    });
  }

  // 3. Buyer Call Form submission logic
  const btnSubmitCall = drawer.querySelector('#btnSubmitCall');
  const callStatusSelect = drawer.querySelector('#callStatusSelect');
  const callNotesText = drawer.querySelector('#callNotesText');
  if (btnSubmitCall && callStatusSelect) {
    btnSubmitCall.addEventListener('click', async () => {
      btnSubmitCall.disabled = true;
      btnSubmitCall.textContent = 'Submitting...';
      try {
        await postJson(`/api/orders/${encodeURIComponent(order.id)}/call-buyer`, {
          callStatus: callStatusSelect.value,
          notes: callNotesText.value
        });
        closeDrawer();
        await loadDashboard();
      } catch (error) {
        btnSubmitCall.textContent = 'Error';
        btnSubmitCall.disabled = false;
        alert(error.message);
      }
    });
  }

  // 4. Per-order Refresh Tracking button
  const btnRefreshTracking = drawer.querySelector('#btnRefreshTracking');
  const trackingRefreshStatus = drawer.querySelector('#trackingRefreshStatus');
  if (btnRefreshTracking) {
    btnRefreshTracking.addEventListener('click', async () => {
      btnRefreshTracking.disabled = true;
      btnRefreshTracking.textContent = '↻ Pulling from Delhivery...';
      if (trackingRefreshStatus) trackingRefreshStatus.textContent = '';
      try {
        const result = await postJson('/api/tracking/sync', {});
        const tracking = result.tracking || {};
        if (trackingRefreshStatus) {
          trackingRefreshStatus.textContent = tracking.skipped
            ? `Skipped: ${tracking.reason || 'disabled'}`
            : `Done — ${tracking.lastPolled ?? 0} checked, ${tracking.lastUpdated ?? 0} updated, ${tracking.lastEvents ?? 0} new events`;
        }
        // Reload the drawer with fresh data
        const fresh = await fetchOrderDetail(order.id);
        drawerTitle.textContent = `Order ${fresh.order.order_number || fresh.order.wix_order_id}`;
        drawerBody.innerHTML = renderDrawer(fresh);
        setupDrawerListeners(fresh);
        await loadDashboard();
      } catch (error) {
        if (trackingRefreshStatus) trackingRefreshStatus.textContent = `Error: ${error.message}`;
        btnRefreshTracking.disabled = false;
        btnRefreshTracking.textContent = '↻ Refresh from Delhivery now';
      }
    });
  }

  // 5. Refresh from Wix button
  const btnRefreshWix = drawer.querySelector('#btnRefreshWix');
  if (btnRefreshWix) {
    btnRefreshWix.addEventListener('click', async () => {
      btnRefreshWix.disabled = true;
      btnRefreshWix.textContent = '↻ Refreshing from Wix...';
      try {
        await postJson(`/api/orders/${encodeURIComponent(order.id)}/refresh-wix`, {});
        const fresh = await fetchOrderDetail(order.id);
        drawerTitle.textContent = `Order ${fresh.order.order_number || fresh.order.wix_order_id}`;
        drawerBody.innerHTML = renderDrawer(fresh);
        setupDrawerListeners(fresh);
        await loadDashboard();
      } catch (error) {
        btnRefreshWix.disabled = false;
        btnRefreshWix.textContent = '↻ Refresh from Wix';
        alert(`Wix refresh failed: ${error.message}`);
      }
    });
  }

  // 6. Mark as Fulfilled button
  const btnMarkFulfilled = drawer.querySelector('#btnMarkFulfilled');
  if (btnMarkFulfilled) {
    btnMarkFulfilled.addEventListener('click', async () => {
      if (!confirm('Mark this order as fulfilled? It will be removed from the packing queue.')) return;
      btnMarkFulfilled.disabled = true;
      btnMarkFulfilled.textContent = 'Marking...';
      try {
        await postJson(`/api/orders/${encodeURIComponent(order.id)}/mark-fulfilled`, {});
        closeDrawer();
        await loadDashboard();
      } catch (error) {
        btnMarkFulfilled.disabled = false;
        btnMarkFulfilled.textContent = '✓ Mark as Fulfilled';
        alert(`Failed: ${error.message}`);
      }
    });
  }
}

function renderDrawerItem(item) {
  const sku = item?.physicalProperties?.sku ? ` · ${item.physicalProperties.sku}` : '';
  return `<li>${escapeHtml(item?.productName?.original || item?.name || 'Item')} x${escapeHtml(item?.quantity || 1)}${escapeHtml(sku)}</li>`;
}

function renderShipmentStatusOptions(currentStatus) {
  const statuses = [
    ['booked', 'Booked / Ready for pickup'],
    ['picked-up', 'Picked up'],
    ['dispatched', 'Dispatched'],
    ['in-transit', 'In transit'],
    ['out-for-delivery', 'Out for delivery'],
    ['delivered', 'Delivered'],
    ['rto', 'RTO'],
    ['failed', 'Failed']
  ];
  const current = String(currentStatus || '').trim().toLowerCase().replace(/_/g, '-');
  return statuses
    .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}

function formatShipmentStatus(status) {
  const labels = {
    booked: 'Booked / Ready for pickup',
    'picked-up': 'Picked up',
    dispatched: 'Dispatched',
    'in-transit': 'In transit',
    'out-for-delivery': 'Out for delivery',
    delivered: 'Delivered',
    rto: 'RTO',
    failed: 'Failed'
  };
  return labels[status] || status;
}

function renderAttempt(attempt) {
  return `
    <div class="attempt ${attempt.success ? 'success' : 'failed'}">
      <strong>#${escapeHtml(attempt.attempt_number)} ${attempt.success ? 'Success' : 'Failed'}</strong>
      <span>${escapeHtml(formatDate(attempt.created_at))}</span>
      <span class="subtle">${escapeHtml(attempt.error || '')}</span>
    </div>
  `;
}

function isBuyerCallComplete(status) {
  return ['answered_confirmed', 'completed'].includes(status || '');
}

function formatBuyerCallStatus(status) {
  const labels = {
    answered_confirmed: 'answered confirmed',
    completed: 'answered confirmed',
    no_answer: 'no answer',
    retry: 'no answer',
    wrong_number: 'wrong number',
    rejected: 'rejected',
    pending: 'pending'
  };
  return labels[status] || status || 'pending';
}

function shipmentLabelUrl(shipment) {
  return shipment?.label_url || shipment?.labelUrl || '';
}

function shipmentLabelError(shipment) {
  return shipment?.label_error || shipment?.labelError || '';
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
