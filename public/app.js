const shipmentsBody = document.querySelector('#shipmentsBody');
const statusText = document.querySelector('#statusText');
const refreshButton = document.querySelector('#refreshButton');
const pullOrdersForm = document.querySelector('#pullOrdersForm');
const wixForm = document.querySelector('#wixForm');
const jsonForm = document.querySelector('#jsonForm');
const orderJson = document.querySelector('#orderJson');
const ordersBody = document.querySelector('#ordersBody');
const ordersStatusText = document.querySelector('#ordersStatusText');
const nextOrdersButton = document.querySelector('#nextOrdersButton');

let pulledOrders = [];
let lastOrderSearch = {};
let nextCursor = '';
const rateCache = new Map();

orderJson.value = JSON.stringify(
  {
    order: {
      id: 'manual-1001',
      number: '1001',
      paymentStatus: 'PAID',
      priceSummary: { total: { amount: '1299' } },
      shippingInfo: {
        logistics: {
          shippingDestination: {
            address: {
              addressLine: '12 MG Road',
              city: 'Bengaluru',
              subdivision: 'KA',
              postalCode: '560001',
              country: 'IN'
            },
            contactDetails: {
              firstName: 'Asha',
              lastName: 'Rao',
              phone: '9876543210'
            }
          }
        }
      },
      lineItems: [{ productName: { original: 'Cotton Shirt' }, quantity: 1 }]
    }
  },
  null,
  2
);

refreshButton.addEventListener('click', loadShipments);
pullOrdersForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const form = new FormData(pullOrdersForm);
    lastOrderSearch = Object.fromEntries(form.entries());
    await loadWixOrders(lastOrderSearch);
  } catch (error) {
    ordersStatusText.textContent = error.message;
  }
});

nextOrdersButton.addEventListener('click', async () => {
  if (!nextCursor) return;
  try {
    await loadWixOrders({ ...lastOrderSearch, cursor: nextCursor });
  } catch (error) {
    ordersStatusText.textContent = error.message;
  }
});

wixForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const orderId = new FormData(wixForm).get('orderId');
    await postJson('/api/book-from-wix', { orderId });
    wixForm.reset();
    await loadShipments();
  } catch (error) {
    statusText.textContent = error.message;
  }
});

jsonForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const payload = JSON.parse(orderJson.value);
    await postJson('/api/book-manual', payload);
    await loadShipments();
  } catch (error) {
    statusText.textContent = error.message;
  }
});

ordersBody.addEventListener('click', async event => {
  const button = event.target.closest('[data-book-order-id]');
  if (!button) return;
  const order = pulledOrders.find(item => item.id === button.dataset.bookOrderId);
  if (!order) return;
  const shippingMode = button.dataset.shippingMode || 'E';
  const internationalService = button.dataset.internationalService || '';
  const reverse = button.dataset.reverse === 'true';

  button.disabled = true;
  button.textContent = 'Booking...';
  try {
    await postJson('/api/book-manual', { order, shippingMode, internationalService, reverse });
    await loadShipments();
    button.textContent = 'Booked';
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Book';
    statusText.textContent = error.message;
  }
});

async function loadShipments() {
  statusText.textContent = 'Loading...';
  const response = await fetch('/api/shipments');
  const data = await response.json();
  const shipments = data.shipments || [];
  shipmentsBody.innerHTML = shipments.map(renderShipment).join('');
  statusText.textContent = `${shipments.length} shipment${shipments.length === 1 ? '' : 's'}`;
}

async function loadWixOrders(params) {
  ordersStatusText.textContent = 'Pulling...';
  const searchParams = new URLSearchParams(removeEmpty(params));
  const response = await fetch(`/api/wix/orders?${searchParams.toString()}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not pull Wix orders');

  pulledOrders = data.orders || [];
  nextCursor =
    data.pagingMetadata?.cursors?.next ||
    data.pagingMetadata?.nextCursor ||
    data.pagingMetadata?.cursor ||
    '';
  ordersBody.innerHTML = pulledOrders.map(renderOrder).join('');
  ordersStatusText.textContent = `${pulledOrders.length} order${pulledOrders.length === 1 ? '' : 's'} pulled`;
  nextOrdersButton.disabled = !nextCursor;
  loadRatesForOrders(pulledOrders).catch(error => {
    ordersStatusText.textContent = error.message;
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function renderShipment(shipment) {
  const message =
    shipment.error ||
    shipment.requestPayload?.shipment?.service ||
    summarizeResponse(shipment.delhiveryResponse) ||
    '';
  return `
    <tr>
      <td><span class="pill ${escapeHtml(shipment.status || '')}">${escapeHtml(shipment.status || '')}</span></td>
      <td>${escapeHtml(shipment.orderNumber || shipment.orderId || '')}</td>
      <td>${escapeHtml(shipment.waybill || '')}</td>
      <td>${escapeHtml(shipment.source || '')}</td>
      <td>${escapeHtml(formatDate(shipment.updatedAt || shipment.createdAt))}</td>
      <td>${escapeHtml(message)}</td>
    </tr>
  `;
}

function renderOrder(order) {
  const destination = order?.shippingInfo?.logistics?.shippingDestination;
  const contact = destination?.contactDetails || order?.billingInfo?.contactDetails || {};
  const customer = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || order?.buyerInfo?.email || 'Customer';
  const total = order?.priceSummary?.total?.formattedAmount || order?.priceSummary?.total?.amount || '';
  const shippingAmount = order?.priceSummary?.shipping?.formattedAmount || order?.priceSummary?.shipping?.amount || '';
  const productSummary = summarizeProducts(order.lineItems || []);
  const rates = rateCache.get(order.id);
  const isInternational = isInternationalOrder(order);

  return `
    <tr>
      <td>${escapeHtml(order.number || order.id || '')}</td>
      <td>${escapeHtml(customer)}</td>
      <td>${escapeHtml(productSummary)}</td>
      <td>${escapeHtml(total)}</td>
      <td>${escapeHtml(shippingAmount)}</td>
      <td>${renderRateCell(order, rates)}</td>
      <td>${escapeHtml(order.paymentStatus || '')}</td>
      <td>${escapeHtml(order.fulfillmentStatus || '')}</td>
      <td>${escapeHtml(formatDate(order.createdDate))}</td>
      <td>${renderActionButtons(order, isInternational)}</td>
    </tr>
  `;
}

function renderActionButtons(order, isInternational) {
  if (isInternational) {
    return `
      <div class="buttonStack">
        <button type="button" data-book-order-id="${escapeHtml(order.id || '')}" data-international-service="Deferred Express">Book Deferred Express</button>
        <button type="button" class="secondary" data-book-order-id="${escapeHtml(order.id || '')}" data-international-service="DLV Saver">Book DLV Saver</button>
      </div>
    `;
  }

  return `
    <div class="buttonStack">
      <button type="button" data-book-order-id="${escapeHtml(order.id || '')}" data-shipping-mode="E">Book Express</button>
      <button type="button" class="secondary" data-book-order-id="${escapeHtml(order.id || '')}" data-shipping-mode="S">Book Surface</button>
      <button type="button" class="secondary" data-book-order-id="${escapeHtml(order.id || '')}" data-shipping-mode="E" data-reverse="true">Book Reverse</button>
    </div>
  `;
}

async function loadRatesForOrders(orders) {
  const domesticOrders = orders.filter(order => {
    const address = order?.shippingInfo?.logistics?.shippingDestination?.address;
    return address?.country === 'IN' && address?.postalCode;
  });
  const internationalOrders = orders.filter(isInternationalOrder);

  await Promise.all(
    domesticOrders.map(async order => {
      const pin = order.shippingInfo.logistics.shippingDestination.address.postalCode;
      const weight = calculateWeightGrams(order);
      const [express, surface] = await Promise.all([
        fetchRate(pin, weight, 'E'),
        fetchRate(pin, weight, 'S')
      ]);
      rateCache.set(order.id, { express, surface });
    })
  );
  await Promise.all(
    internationalOrders.map(async order => {
      const country = order.shippingInfo.logistics.shippingDestination.address.country;
      const weight = calculateWeightGrams(order);
      const [deferredExpress, dlvSaver] = await Promise.all([
        fetchInternationalRate(country, weight, 'Deferred Express'),
        fetchInternationalRate(country, weight, 'DLV Saver')
      ]);
      rateCache.set(order.id, { deferredExpress, dlvSaver });
    })
  );

  ordersBody.innerHTML = pulledOrders.map(renderOrder).join('');
}

async function fetchRate(pin, weight, mode) {
  const key = `${pin}:${weight}:${mode}`;
  if (rateCache.has(key)) return rateCache.get(key);

  const response = await fetch(`/api/delhivery/rate?pin=${encodeURIComponent(pin)}&weight=${weight}&mode=${mode}`);
  const data = await response.json();
  if (!response.ok) return { error: data.error || 'Rate unavailable' };
  const result = Array.isArray(data) ? data[0] : data;
  rateCache.set(key, result);
  return result;
}

async function fetchInternationalRate(country, weight, service) {
  const key = `${country}:${weight}:${service}`;
  if (rateCache.has(key)) return rateCache.get(key);

  const response = await fetch(
    `/api/delhivery/international-rate?country=${encodeURIComponent(country)}&weight=${weight}&service=${encodeURIComponent(service)}`
  );
  const data = await response.json();
  if (!response.ok) return { available: false, error: data.error || 'Rate unavailable', service };
  rateCache.set(key, data);
  return data;
}

function renderRateCell(order, rates) {
  const country = order?.shippingInfo?.logistics?.shippingDestination?.address?.country;
  if (country && country !== 'IN') {
    const wixShipping = order?.priceSummary?.shipping?.formattedAmount || order?.priceSummary?.shipping?.amount || 'NA';
    if (!rates) {
      return `<span class="muted">Loading...<br />Wix charged: ${escapeHtml(wixShipping)}</span>`;
    }
    return `
      <div class="rates">
        <span>Deferred: ${escapeHtml(formatInternationalRate(rates.deferredExpress))}</span>
        <span>Saver: ${escapeHtml(formatInternationalRate(rates.dlvSaver))}</span>
        <span>Wix charged: ${escapeHtml(wixShipping)}</span>
      </div>
    `;
  }
  if (!rates) return '<span class="muted">Loading...</span>';
  return `
    <div class="rates">
      <span>E: ${escapeHtml(formatRate(rates.express))}</span>
      <span>S: ${escapeHtml(formatRate(rates.surface))}</span>
    </div>
  `;
}

function formatInternationalRate(rate) {
  if (!rate?.available) return 'Not configured';
  const currency = rate.currency || 'INR';
  const tat = rate.tatDays ? ` (${rate.tatDays}d)` : '';
  return `${currency} ${rate.amount}${tat}`;
}

function isInternationalOrder(order) {
  const country = order?.shippingInfo?.logistics?.shippingDestination?.address?.country;
  return Boolean(country && country !== 'IN');
}

function formatRate(rate) {
  if (!rate) return 'NA';
  if (rate.error) return 'NA';
  const amount = rate.total_amount ?? rate.gross_amount;
  const zone = rate.zone ? ` Z${rate.zone}` : '';
  return amount ? `Rs ${amount}${zone}` : 'NA';
}

function calculateWeightGrams(order) {
  const totalKg = (order.lineItems || []).reduce((sum, item) => {
    const weight = Number(item?.physicalProperties?.weight || 0);
    const quantity = Number(item?.quantity || 1);
    return sum + weight * quantity;
  }, 0);
  return Math.max(1, Math.round(totalKg * 1000) || 400);
}

function summarizeProducts(lineItems) {
  return lineItems
    .map(item => {
      const name = item?.productName?.original || item?.productName?.translated || item?.name || 'Item';
      const quantity = Number(item?.quantity || 1);
      const price =
        item?.totalPriceAfterTax?.formattedAmount ||
        item?.lineItemPrice?.formattedAmount ||
        item?.price?.formattedAmount ||
        '';
      return `${name} x${quantity}${price ? ` (${price})` : ''}`;
    })
    .join(', ');
}

function summarizeResponse(response) {
  if (!response) return '';
  if (response.success) return 'Booked successfully';
  if (response.message) return response.message;
  if (response.packages?.[0]?.remarks?.length) return response.packages[0].remarks.join(', ');
  return JSON.stringify(response).slice(0, 160);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[char];
  });
}

function removeEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

loadShipments().catch(error => {
  statusText.textContent = error.message;
});
