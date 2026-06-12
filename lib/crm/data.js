import { createServiceClient } from '@/lib/supabase/server';
import { seedIntegrationErrors, seedOrders, seedPackingChecklist, seedTasks, seedTimeline } from './seed';

export function normalizeStatusLabel(value = '') {
  return String(value || 'not_set').replaceAll('_', ' ');
}

export function formatCurrency(value, currency = 'INR') {
  if (value === null || value === undefined || value === '') return '-';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(Number(value));
}

export function getSupabaseMode() {
  return Boolean(createServiceClient());
}

export async function listOrders({ query = '', status = '', source = '', limit = 100 } = {}) {
  const supabase = createServiceClient();
  if (!supabase) return filterSeedOrders({ query, status, source, limit });

  let request = supabase
    .from('orders')
    .select(`
      id, external_order_id, order_number, source, status, payment_status, total_amount, currency,
      source_created_at, internal_status, shipment_status, installation_status, feedback_status,
      installation_method, install_location, garage_name, garage_contact_person, garage_phone, garage_email,
      garage_address, garage_city, garage_state, garage_pincode,
      bike_model, product_variant, quantity, assigned_operator, tags, notes, courier, awb_number,
      shipment_label_url, shipment_label_format, shipment_label_error,
      tracking_url, chatwoot_contact_id, chatwoot_conversation_id, last_communication_at, last_message_type,
      customers(name,email,phone,tax_id,tax_id_type),
      shipping_address:customer_addresses!orders_shipping_address_id_fkey(name,phone,address_line1,address_line2,city,state,postal_code,country),
      billing_address:customer_addresses!orders_billing_address_id_fkey(name,phone,address_line1,address_line2,city,state,postal_code,country)
    `)
    .order('source_created_at', { ascending: false })
    .limit(limit);

  if (status) request = request.eq('internal_status', status);
  if (source) request = request.eq('source', source);
  if (query) {
    const escaped = query.replaceAll(',', ' ');
    request = request.or(`order_number.ilike.%${escaped}%,external_order_id.ilike.%${escaped}%,awb_number.ilike.%${escaped}%,bike_model.ilike.%${escaped}%`);
  }

  const { data, error } = await request;
  if (error) {
    const legacyOrders = await listLegacyOrders(supabase, { query, status, source, limit });
    if (legacyOrders) return legacyOrders;
    return [];
  }
  return data.map(mapOrderRow);
}

export async function getOrder(id) {
  const supabase = createServiceClient();
  if (!supabase) return getSeedOrder(id);

  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      customers(*),
      shipping_address:customer_addresses!orders_shipping_address_id_fkey(*),
      billing_address:customer_addresses!orders_billing_address_id_fkey(*),
      order_items(*),
      payment_refs(*),
      shipments(*),
      packing_checklists(*),
      installation_records:installation_status(*),
      feedback(*),
      notes(*),
      tasks(*),
      status_history(*)
    `)
    .eq('id', id)
    .single();

  if (error) return getLegacyOrder(supabase, id);
  return mapOrderDetail(data);
}

export async function listTasks() {
  const supabase = createServiceClient();
  if (!supabase) return seedTasks;

  const { data, error } = await supabase
    .from('tasks')
    .select('id,title,order_id,assigned_operator,due_date,priority,status,notes,orders(order_number)')
    .order('due_date', { ascending: true })
    .limit(200);
  if (error) return seedTasks;
  return data.map(task => ({ ...task, order_number: task.orders?.order_number || '' }));
}

export async function listIntegrationErrors() {
  const supabase = createServiceClient();
  if (!supabase) return seedIntegrationErrors;

  const { data, error } = await supabase
    .from('integration_errors')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(200);
  if (error) return seedIntegrationErrors;
  return data;
}

export async function getDashboardSummary() {
  const orders = await listOrders({ limit: 500 });
  const tasks = await listTasks();
  const today = new Date().toISOString().slice(0, 10);
  const paidActiveOrders = orders.filter(isPaidActiveOrder);
  return {
    newOrders: paidActiveOrders.filter(order => order.internal_status === 'new' || order.internal_status === 'awaiting_packing').length,
    ordersToPack: paidActiveOrders.filter(order => ['new', 'awaiting_packing'].includes(order.internal_status)).length,
    shipmentsToBook: paidActiveOrders.filter(order => ['packed', 'awaiting_packing'].includes(order.internal_status) && !order.awb_number).length,
    pickupPending: orders.filter(order => order.shipment_status === 'pickup_pending').length,
    deliveredToday: orders.filter(order => order.shipment_status === 'delivered' && String(order.updated_at || '').startsWith(today)).length,
    installationDue: tasks.filter(task => task.title.toLowerCase().includes('installation') && task.status !== 'done').length,
    feedbackDue: tasks.filter(task => task.title.toLowerCase().includes('feedback') && task.status !== 'done').length,
    openIssues: orders.filter(order => ['issue_reported', 'warranty_case'].includes(order.internal_status)).length,
    avgOrderToShipmentHours: 18,
    avgShipmentToDeliveryDays: 3.2,
    failedPickups: orders.filter(order => order.shipment_status === 'failed_delivery').length,
    rtoCount: orders.filter(order => order.internal_status === 'rto').length,
    installationCompletionRate: completionRate(orders, 'installation_status', 'installed_successfully'),
    feedbackCompletionRate: completionRate(orders, 'feedback_status', ['positive_feedback', 'negative_feedback', 'review_received', 'ugc_received'])
  };
}

export async function updateOrder(id, payload) {
  const supabase = createServiceClient();
  if (!supabase) return { ok: true, demo: true, order: { ...getSeedOrder(id).order, ...payload } };

  const orderPatch = {
    source: payload.source,
    external_order_id: payload.external_order_id,
    order_number: payload.order_number,
    payment_status: payload.payment_status,
    total_amount: payload.order_value,
    bike_model: payload.bike_model,
    product_variant: payload.product_variant,
    quantity: payload.quantity,
    internal_status: payload.internal_status,
    shipment_status: payload.shipment_status,
    installation_status: payload.installation_status,
    feedback_status: payload.feedback_status,
    installation_method: payload.installation_method,
    install_location: payload.install_location,
    garage_name: payload.garage_name,
    garage_contact_person: payload.garage_contact_person,
    garage_phone: payload.garage_phone,
    garage_email: payload.garage_email,
    garage_address: payload.garage_address,
    garage_city: payload.garage_city,
    garage_state: payload.garage_state,
    garage_pincode: payload.garage_pincode,
    assigned_operator: payload.assigned_operator,
    tags: splitTags(payload.tags),
    notes: payload.notes,
    courier: payload.courier,
    awb_number: payload.awb_number,
    tracking_url: payload.tracking_url,
    updated_at: new Date().toISOString()
  };

  const { data: current } = await supabase.from('orders').select('*').eq('id', id).single();
  const existingColumns = new Set(Object.keys(current || {}));
  const { patch: safeOrderPatch, skipped } = existingColumns.size
    ? filterExistingColumns(orderPatch, existingColumns)
    : { patch: orderPatch, skipped: [] };
  const { error } = await supabase.from('orders').update(safeOrderPatch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  const relatedWrites = await persistRelatedOrderState(supabase, id, payload, skipped, current);

  await supabase.from('status_history').insert({
    order_id: id,
    field_name: 'order_update',
    old_value: current ? JSON.stringify(pickAuditFields(current)) : '',
    new_value: JSON.stringify(pickAuditFields(safeOrderPatch)),
    notes: payload.change_notes || 'Operator updated order details',
    actor_name: payload.actor_name || 'Operator'
  });

  return { ok: true, skipped_columns: skipped, warnings: relatedWrites.warnings };
}

function filterExistingColumns(patch, existingColumns) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  return {
    patch: Object.fromEntries(entries.filter(([column]) => existingColumns.has(column))),
    skipped: entries.filter(([column]) => !existingColumns.has(column)).map(([column]) => column)
  };
}

async function persistRelatedOrderState(supabase, orderId, payload, skippedColumns, currentOrder = {}) {
  const warnings = [];
  const missing = new Set(skippedColumns);

  if (currentOrder?.customer_id) {
    const { error } = await supabase
      .from('customers')
      .update(stripUndefined({
        name: payload.customer_name,
        email: payload.email,
        phone: payload.phone,
        tax_id: payload.buyer_gst,
        tax_id_type: payload.buyer_gst_type,
        updated_at: new Date().toISOString()
      }))
      .eq('id', currentOrder.customer_id);
    if (error) warnings.push(`Customer details were not persisted: ${error.message}`);
  }

  const addressResult = await persistOrderAddresses(supabase, orderId, payload, currentOrder);
  warnings.push(...addressResult.warnings);

  if (missing.has('installation_status') || missing.has('installation_method')) {
    const installationPatch = stripUndefined({
      order_id: orderId,
      status: payload.installation_status,
      installation_method: payload.installation_method,
      install_location: payload.install_location,
      garage_name: payload.garage_name,
      garage_contact_person: payload.garage_contact_person,
      garage_phone: payload.garage_phone,
      garage_email: payload.garage_email,
      garage_address: payload.garage_address,
      garage_city: payload.garage_city,
      garage_state: payload.garage_state,
      garage_pincode: payload.garage_pincode,
      notes: payload.change_notes,
      updated_at: new Date().toISOString()
    });
    const { data: existing } = await supabase
      .from('installation_status')
      .select('id')
      .eq('order_id', orderId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const result = existing?.id
      ? await supabase.from('installation_status').update(installationPatch).eq('id', existing.id)
      : await supabase.from('installation_status').insert(installationPatch);
    if (result.error) warnings.push(`Installation state was not persisted: ${result.error.message}`);
  }

  if (missing.has('feedback_status')) {
    const { error } = await supabase.from('feedback').insert({
      order_id: orderId,
      status: payload.feedback_status,
      feedback_text: payload.change_notes || null
    });
    if (error) warnings.push(`Feedback state was not persisted: ${error.message}`);
  }

  return { warnings };
}

async function persistOrderAddresses(supabase, orderId, payload, currentOrder = {}) {
  const warnings = [];
  const shippingPayload = addressPayload('shipping', payload);
  const billingPayload = addressPayload('billing', payload);

  const shipping = await upsertOrderAddress(supabase, {
    orderId,
    customerId: currentOrder.customer_id,
    existingAddressId: currentOrder.shipping_address_id,
    foreignKey: 'shipping_address_id',
    address: shippingPayload
  });
  if (shipping.error) warnings.push(`Shipping address was not persisted: ${shipping.error}`);

  const billing = await upsertOrderAddress(supabase, {
    orderId,
    customerId: currentOrder.customer_id,
    existingAddressId: currentOrder.billing_address_id,
    foreignKey: 'billing_address_id',
    address: billingPayload
  });
  if (billing.error) warnings.push(`Billing address was not persisted: ${billing.error}`);

  return { warnings };
}

async function upsertOrderAddress(supabase, { orderId, customerId, existingAddressId, foreignKey, address }) {
  if (!hasAddressValue(address)) return {};
  const row = {
    ...address,
    customer_id: customerId || null,
    updated_at: new Date().toISOString()
  };
  if (existingAddressId) {
    const { error } = await supabase.from('customer_addresses').update(row).eq('id', existingAddressId);
    return error ? { error: error.message } : {};
  }

  const { data, error } = await supabase
    .from('customer_addresses')
    .insert({ ...row, created_at: new Date().toISOString() })
    .select()
    .single();
  if (error) return { error: error.message };

  const { error: orderError } = await supabase
    .from('orders')
    .update({ [foreignKey]: data.id, updated_at: new Date().toISOString() })
    .eq('id', orderId);
  return orderError ? { error: orderError.message } : {};
}

function addressPayload(type, payload) {
  const prefix = `${type}_`;
  return stripUndefined({
    address_type: type,
    name: payload[`${prefix}name`] || payload.customer_name,
    phone: payload[`${prefix}phone`] || payload.phone,
    address_line1: payload[`${prefix}address_line1`] || (type === 'shipping' ? payload.address_line1 : undefined),
    address_line2: payload[`${prefix}address_line2`] || (type === 'shipping' ? payload.address_line2 : undefined),
    city: payload[`${prefix}city`] || (type === 'shipping' ? payload.city : undefined),
    state: payload[`${prefix}state`] || (type === 'shipping' ? payload.state : undefined),
    postal_code: payload[`${prefix}pincode`] || (type === 'shipping' ? payload.pincode : undefined),
    country: payload[`${prefix}country`] || (type === 'shipping' ? payload.country : undefined)
  });
}

function hasAddressValue(address) {
  return ['name', 'phone', 'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country']
    .some(key => address[key] !== undefined && address[key] !== null && address[key] !== '');
}

export async function createManualOrder(payload) {
  const supabase = createServiceClient();
  const duplicate = await detectDuplicate(payload);
  if (duplicate) return { ok: false, duplicate };
  if (!supabase) {
    return { ok: true, demo: true, id: `demo-${Date.now()}` };
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .insert({
      name: payload.customer_name,
      email: payload.email,
      phone: payload.phone
    })
    .select()
    .single();
  if (customerError) return { ok: false, error: customerError.message };

  const { data: address, error: addressError } = await supabase
    .from('customer_addresses')
    .insert({
      customer_id: customer.id,
      address_type: 'shipping',
      name: payload.customer_name,
      phone: payload.phone,
      address_line1: payload.address_line1,
      address_line2: payload.address_line2,
      city: payload.city,
      state: payload.state,
      postal_code: payload.pincode,
      country: payload.country || 'IN'
    })
    .select()
    .single();
  if (addressError) return { ok: false, error: addressError.message };

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      wix_order_id: null,
      external_order_id: payload.external_order_id || `MAN-${Date.now()}`,
      order_number: payload.order_number || payload.external_order_id,
      source: payload.source || 'manual',
      customer_id: customer.id,
      shipping_address_id: address.id,
      payment_status: payload.payment_status || 'paid',
      total_amount: payload.order_value,
      currency: payload.currency || 'INR',
      source_created_at: payload.order_date || new Date().toISOString(),
      internal_status: 'new',
      shipment_status: 'not_booked',
      installation_status: 'not_contacted',
      feedback_status: 'feedback_pending',
      bike_model: payload.bike_model,
      product_variant: payload.product_variant,
      quantity: payload.quantity || 1,
      assigned_operator: payload.assigned_operator,
      tags: splitTags(payload.tags),
      notes: payload.notes
    })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: order.id };
}

export async function bookShipment(orderId, payload) {
  const validation = validateShipmentPayload(payload);
  if (validation.length) return { ok: false, validation };
  const supabase = createServiceClient();
  const action = payload.booking_action || 'book_courier';

  if (!supabase) {
    return { ok: true, demo: true, awb_number: payload.awb_number || 'DEMOAWB123' };
  }

  if (action === 'book_courier') return bookCourierShipment(orderId, payload, supabase);

  if (!payload.awb_number) return { ok: false, validation: ['AWB is required for manual shipment save'] };
  const trackingUrl = payload.tracking_url || trackingUrlFor(payload.courier, payload.awb_number);

  const { data: shipment, error: shipmentError } = await supabase.from('shipments').insert({
    order_id: orderId,
    courier_code: payload.courier,
    status: 'shipment_booked',
    waybill: payload.awb_number,
    pickup_location: payload.pickup_location,
    length_cm: payload.length_cm,
    width_cm: payload.width_cm,
    height_cm: payload.height_cm,
    weight_grams: payload.weight_grams,
    cod_amount: payload.payment_mode === 'COD' ? payload.product_value : 0,
    label_url: payload.label_url,
    carrier_response: {
      booking_status: 'manual_or_adapter_ready',
      insurance: payload.insurance === 'on',
      payment_mode: payload.payment_mode,
      courier_response: payload.courier_response || null
    }
  }).select().single();
  if (shipmentError) return { ok: false, error: shipmentError.message };
  if (payload.label_url) {
    await syncOrderLabelSummary(supabase, orderId, {
      label_url: payload.label_url,
      label_format: inferLabelFormat(payload.label_url),
      label_error: null
    });
  }

  const { error } = await updateOrderShipmentSummary(supabase, orderId, {
    courier: payload.courier,
    awb_number: payload.awb_number,
    tracking_url: trackingUrl,
    shipment_waybill: payload.awb_number,
    shipment_courier_code: payload.courier,
    shipment_status: 'shipment_booked',
    internal_status: 'shipment_booked',
    shipment_booked_at: new Date().toISOString()
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, shipment, awb_number: payload.awb_number, tracking_url: trackingUrl, label_url: payload.label_url || '' };
}

export async function generateShipmentLabel(orderId) {
  const supabase = createServiceClient();
  if (!supabase) return { ok: true, demo: true, label_url: '' };
  const shipment = await latestShipmentForOrder(supabase, orderId);
  if (!shipment) return { ok: false, error: 'No shipment exists for this order.' };
  if (!shipment.waybill) return { ok: false, error: 'AWB is required before generating a label.' };
  if (shipment.label_url) return { ok: true, shipment, label_url: shipment.label_url };
  if ((shipment.courier_code || 'delhivery') !== 'delhivery') {
    return { ok: false, error: 'Label generation is currently configured only for Delhivery shipments.' };
  }

  try {
    const { getConfig } = await import('@/src/config.js');
    const { createShipmentLabel } = await import('@/src/labels.js');
    const label = await createShipmentLabel(shipment, getConfig());
    const { data: updated, error } = await supabase
      .from('shipments')
      .update({
        label_url: label.label_url,
        label_format: label.label_format,
        label_generated_at: label.label_generated_at,
        label_error: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', shipment.id)
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    await syncOrderLabelSummary(supabase, orderId, label);
    return { ok: true, shipment: updated, label_url: label.label_url };
  } catch (error) {
    const message = error.message || 'Label generation failed.';
    await supabase
      .from('shipments')
      .update({ label_error: message, updated_at: new Date().toISOString() })
      .eq('id', shipment.id);
    await syncOrderLabelSummary(supabase, orderId, { label_url: null, label_format: null, label_error: message });
    return { ok: false, error: message };
  }
}

export async function downloadShipmentLabelFile(shipmentId) {
  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };

  const { data: shipment, error } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', shipmentId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!shipment) return { ok: false, error: 'Shipment not found.' };
  if (!shipment.waybill) return { ok: false, error: 'AWB is required before downloading a label.' };
  if ((shipment.courier_code || 'delhivery') !== 'delhivery') {
    return { ok: false, error: 'Label download is currently configured only for Delhivery shipments.' };
  }

  try {
    const { getConfig } = await import('@/src/config.js');
    const { fetchShipmentLabelFile } = await import('@/src/labels.js');
    const file = await fetchShipmentLabelFile(shipment, getConfig());
    return { ok: true, ...file };
  } catch (error) {
    const message = error.message || 'Label download failed.';
    await supabase
      .from('shipments')
      .update({ label_error: message, updated_at: new Date().toISOString() })
      .eq('id', shipment.id);
    await syncOrderLabelSummary(supabase, shipment.order_id, { label_url: null, label_format: null, label_error: message });
    return { ok: false, error: message };
  }
}

async function bookCourierShipment(orderId, payload, supabase) {
  if (payload.courier !== 'delhivery') {
    return {
      ok: false,
      error: `${String(payload.courier || 'Selected courier').replaceAll('_', ' ')} booking is not configured yet. Use manual AWB save for this courier.`
    };
  }

  const { data: order, error } = await getShipmentBookingOrder(supabase, orderId);
  if (error) return { ok: false, error: error.message };
  if (!order) return { ok: false, error: 'Order not found.' };
  if (!isPaidStatus(order.payment_status)) return { ok: false, error: 'Only paid orders can be booked for shipment.' };
  if ((order.source || 'wix') !== 'wix' || !(order.wix_order_id || order.external_order_id)) {
    return { ok: false, error: 'Direct courier booking is currently wired for Wix orders. Use manual AWB save for manual/Amazon orders.' };
  }

  const serviceOptions = bookingOptionsForService(payload.service_code);
  const { getConfig } = await import('@/src/config.js');
  const { bookWixOrder, bookWixOrderById } = await import('@/src/booking.js');
  const config = configWithShipmentDefaults(getConfig(), payload, serviceOptions);

  try {
    const result = order.raw_order
      ? await bookWixOrder(order.raw_order, config, {
          source: 'crm',
          courierCode: payload.courier,
          shippingMode: serviceOptions.shippingMode,
          internationalService: serviceOptions.internationalService,
          reverse: serviceOptions.reverse === true,
          serviceCode: payload.service_code,
          pickupLocation: payload.pickup_location,
          insurance: payload.insurance === 'on'
        })
      : await bookWixOrderById(order.wix_order_id || order.external_order_id, config, {
      source: 'crm',
      courierCode: payload.courier,
      shippingMode: serviceOptions.shippingMode,
      internationalService: serviceOptions.internationalService,
      reverse: serviceOptions.reverse === true,
      serviceCode: payload.service_code,
      pickupLocation: payload.pickup_location,
      insurance: payload.insurance === 'on'
    });
    const shipment = result.shipment || {};
    const awb = shipment.waybill || '';
    const trackingUrl = shipment.tracking_url || trackingUrlFor(payload.courier, awb);
    const { error: updateError } = await updateOrderShipmentSummary(supabase, orderId, {
      courier: payload.courier,
      awb_number: awb || null,
      tracking_url: trackingUrl || null,
      shipment_waybill: awb || null,
      shipment_courier_code: payload.courier,
      shipment_service_code: payload.service_code || null,
      shipment_service_mode: serviceOptions.internationalService || (serviceOptions.shippingMode === 'S' ? 'Surface' : 'Express'),
      shipment_status: normalizeBookedShipmentStatus(shipment.status),
      internal_status: awb || shipment.status === 'pending-international' ? 'shipment_booked' : 'pickup_pending',
      shipment_booked_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    if (updateError) return { ok: false, error: updateError.message, shipment };

    return {
      ok: true,
      skipped: result.skipped,
      shipment,
      awb_number: awb,
      tracking_url: trackingUrl,
      label_url: shipment.label_url || '',
      message: shipment.message || (awb ? 'Shipment booked with courier.' : 'Shipment queued without AWB.')
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || 'Courier booking failed.',
      shipment: error.shipment || null
    };
  }
}

async function getShipmentBookingOrder(supabase, orderId) {
  const primary = await supabase
    .from('orders')
    .select('id,wix_order_id,external_order_id,order_number,source,payment_status,raw_order')
    .eq('id', orderId)
    .maybeSingle();
  if (!isMissingColumnError(primary.error)) return primary;

  const legacy = await supabase
    .from('orders')
    .select('id,wix_order_id,order_number,payment_status,raw_order')
    .eq('id', orderId)
    .maybeSingle();
  return {
    ...legacy,
    data: legacy.data
      ? {
          ...legacy.data,
          external_order_id: legacy.data.wix_order_id,
          source: 'wix'
        }
      : legacy.data
  };
}

async function updateOrderShipmentSummary(supabase, orderId, patch) {
  const primary = await supabase.from('orders').update(patch).eq('id', orderId);
  if (!isMissingColumnError(primary.error)) return primary;

  const legacyPatch = stripUndefined({
    shipment_waybill: patch.shipment_waybill || patch.awb_number,
    shipment_courier_code: patch.shipment_courier_code || patch.courier,
    shipment_service_code: patch.shipment_service_code,
    shipment_service_mode: patch.shipment_service_mode,
    shipment_status: patch.shipment_status,
    shipment_booked_at: patch.shipment_booked_at,
    updated_at: patch.updated_at || new Date().toISOString()
  });
  return supabase.from('orders').update(legacyPatch).eq('id', orderId);
}

function isMissingColumnError(error) {
  return Boolean(
    error &&
      (error.code === '42703' ||
        error.code === 'PGRST204' ||
        /column .* does not exist|could not find .* column|schema cache/i.test(error.message || ''))
  );
}

export async function updatePacking(orderId, payload) {
  const supabase = createServiceClient();
  if (!supabase) return { ok: true, demo: true };
  const items = Object.entries(payload)
    .filter(([key]) => key.startsWith('item:'))
    .map(([key, value]) => ({ item_name: key.slice(5), is_packed: value === 'on' }));

  for (const item of items) {
    await supabase
      .from('packing_checklists')
      .upsert({ order_id: orderId, ...item, checked_at: item.is_packed ? new Date().toISOString() : null }, { onConflict: 'order_id,item_name' });
  }

  const allPacked = items.length > 0 && items.every(item => item.is_packed);
  const { error } = await supabase
    .from('orders')
    .update({
      package_weight_grams: payload.package_weight_grams || null,
      package_length_cm: payload.package_length_cm || null,
      package_width_cm: payload.package_width_cm || null,
      package_height_cm: payload.package_height_cm || null,
      packing_photo_url: payload.packing_photo_url || null,
      internal_status: allPacked ? 'packed' : 'awaiting_packing',
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function sendCommunication(orderId, messageType) {
  const supabase = createServiceClient();
  if (!supabase) return { ok: true, demo: true };
  const { error } = await supabase
    .from('orders')
    .update({
      last_message_type: messageType,
      last_communication_at: new Date().toISOString()
    })
    .eq('id', orderId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function filterSeedOrders({ query = '', status = '', source = '', limit = 100, error = '' }) {
  const q = query.toLowerCase();
  return seedOrders
    .filter(order => !status || order.internal_status === status)
    .filter(order => !source || order.source === source)
    .filter(order => !q || [order.customer_name, order.phone, order.external_order_id, order.order_number, order.awb_number, order.bike_model, order.source].join(' ').toLowerCase().includes(q))
    .slice(0, limit)
    .map(order => ({ ...order, _demo_error: error }));
}

function getSeedOrder(id, error = '') {
  const order = seedOrders.find(item => item.id === id) || seedOrders[0];
  return {
    order: { ...order, _demo_error: error },
    timeline: seedTimeline(order),
    packingChecklist: seedPackingChecklist(order),
    tasks: seedTasks.filter(task => task.order_id === order.id),
    notes: order.notes ? [{ id: `${order.id}-note`, body: order.notes, actor_name: order.assigned_operator, created_at: order.order_date }] : [],
    attachments: []
  };
}

function mapOrderRow(row) {
  const address = row.shipping_address || {};
  const billingAddress = row.billing_address || {};
  const rawVat = wixVatId(row.raw_order);
  const installationRecord = latestRelatedRecord(row.installation_records || (Array.isArray(row.installation_status) ? row.installation_status : []));
  const feedbackRecord = latestRelatedRecord(row.feedback || []);
  return {
    id: row.id,
    external_order_id: row.external_order_id || row.wix_order_id,
    order_number: row.order_number,
    source: row.source || 'wix',
    customer_name: row.customers?.name || '',
    phone: row.customers?.phone || '',
    email: row.customers?.email || '',
    buyer_gst: row.customers?.tax_id || rawVat.id || '',
    buyer_gst_type: row.customers?.tax_id_type || rawVat.type || '',
    address_line1: address.address_line1 || '',
    address_line2: address.address_line2 || '',
    city: address.city || '',
    state: address.state || '',
    pincode: address.postal_code || '',
    country: address.country || 'IN',
    shipping_name: address.name || row.customers?.name || '',
    shipping_phone: address.phone || row.customers?.phone || '',
    shipping_address_line1: address.address_line1 || '',
    shipping_address_line2: address.address_line2 || '',
    shipping_city: address.city || '',
    shipping_state: address.state || '',
    shipping_pincode: address.postal_code || '',
    shipping_country: address.country || 'IN',
    billing_name: billingAddress.name || row.customers?.name || '',
    billing_phone: billingAddress.phone || row.customers?.phone || '',
    billing_address_line1: billingAddress.address_line1 || '',
    billing_address_line2: billingAddress.address_line2 || '',
    billing_city: billingAddress.city || '',
    billing_state: billingAddress.state || '',
    billing_pincode: billingAddress.postal_code || '',
    billing_country: billingAddress.country || '',
    bike_model: row.bike_model || '',
    product_variant: row.product_variant || '',
    quantity: row.quantity || 1,
    payment_status: row.payment_status || '',
    order_value: row.total_amount || 0,
    subtotal_amount: row.subtotal || 0,
    shipping_amount: row.shipping_amount || 0,
    tax_amount: row.tax_amount || 0,
    discount_amount: row.discount_amount || 0,
    currency: row.currency || 'INR',
    order_date: row.source_created_at,
    internal_status: row.internal_status || row.status || 'new',
    shipment_status: row.shipment_status || 'not_booked',
    installation_status: scalarStatus(row.installation_status) || installationRecord?.status || 'not_contacted',
    installation_method: row.installation_method || installationRecord?.installation_method || 'unknown',
    install_location: row.install_location || installationRecord?.install_location || '',
    garage_name: row.garage_name || installationRecord?.garage_name || '',
    garage_contact_person: row.garage_contact_person || installationRecord?.garage_contact_person || '',
    garage_phone: row.garage_phone || installationRecord?.garage_phone || '',
    garage_email: row.garage_email || installationRecord?.garage_email || '',
    garage_address: row.garage_address || installationRecord?.garage_address || '',
    garage_city: row.garage_city || installationRecord?.garage_city || '',
    garage_state: row.garage_state || installationRecord?.garage_state || '',
    garage_pincode: row.garage_pincode || installationRecord?.garage_pincode || '',
    feedback_status: scalarStatus(row.feedback_status) || feedbackRecord?.status || 'feedback_pending',
    assigned_operator: row.assigned_operator || '',
    tags: row.tags || [],
    notes: row.notes || '',
    courier: row.courier || row.shipment_courier_code || '',
    awb_number: row.awb_number || row.shipment_waybill || '',
    label_url: row.label_url || row.shipment_label_url || '',
    label_format: row.label_format || row.shipment_label_format || '',
    label_error: row.label_error || row.shipment_label_error || '',
    tracking_url: row.tracking_url || '',
    chatwoot_contact_id: row.chatwoot_contact_id || '',
    chatwoot_conversation_id: row.chatwoot_conversation_id || '',
    last_communication_at: row.last_communication_at,
    last_message_type: row.last_message_type || ''
  };
}

function wixVatId(value) {
  if (!value || typeof value !== 'object') return { id: '', type: '' };
  const candidates = [
    value.billingInfo?.contactDetails?.vatId,
    value.billingInfo?.vatId,
    value.buyerInfo?.vatId,
    value.contactDetails?.vatId,
    value.vatId
  ];
  for (const candidate of candidates) {
    const id = typeof candidate === 'string' ? candidate : candidate?.id || candidate?.value || candidate?.number;
    if (id) return { id, type: typeof candidate === 'object' ? candidate.type || candidate.name || 'VAT' : 'VAT' };
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      const found = wixVatId(nested);
      if (found.id) return found;
    }
  }
  return { id: '', type: '' };
}

async function listLegacyOrders(supabase, { query = '', status = '', source = '', limit = 100 } = {}) {
  if (source && source !== 'wix') return [];
  let request = supabase
    .from('orders')
    .select(`
      id, wix_order_id, order_number, status, payment_status, fulfillment_status, total_amount, currency,
      source_created_at, source_updated_at, shipment_status, shipment_waybill, shipment_courier_code,
      shipment_label_url, shipment_label_format, shipment_label_error,
      selected_shipping_title, raw_order,
      customers(name,email,phone,tax_id,tax_id_type),
      shipping_address:customer_addresses!orders_shipping_address_id_fkey(name,phone,address_line1,address_line2,city,state,postal_code,country),
      billing_address:customer_addresses!orders_billing_address_id_fkey(name,phone,address_line1,address_line2,city,state,postal_code,country)
    `)
    .order('source_created_at', { ascending: false })
    .limit(query ? 1000 : Math.max(limit, 100));

  if (status) {
    if (status === 'awaiting_packing' || status === 'new') request = request.eq('fulfillment_status', 'NOT_FULFILLED').in('payment_status', ['PAID', 'APPROVED']);
    else if (status === 'not_paid') request = request.not('payment_status', 'in', '(PAID,APPROVED)');
    else if (status === 'cancelled') request = request.eq('status', 'CANCELED');
    else if (status === 'completed' || status === 'fulfilled_no_tracking') request = request.eq('fulfillment_status', 'FULFILLED');
  }

  const { data, error } = await request;
  if (error) return null;
  const shipmentByOrderId = await latestShipmentMapForOrders(supabase, data.map(order => order.id));
  const q = query.toLowerCase();
  return data
    .map(order => mapLegacyOrderRow(order, shipmentByOrderId.get(order.id)))
    .filter(order => !status || order.internal_status === status || (status === 'new' && order.internal_status === 'awaiting_packing'))
    .filter(order => !q || [order.customer_name, order.phone, order.external_order_id, order.order_number, order.awb_number, order.bike_model, order.source].join(' ').toLowerCase().includes(q))
    .slice(0, limit);
}

async function getLegacyOrder(supabase, id) {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, wix_order_id, order_number, status, payment_status, fulfillment_status, total_amount, currency,
      source_created_at, source_updated_at, shipment_status, shipment_waybill, shipment_courier_code,
      shipment_label_url, shipment_label_format, shipment_label_error,
      selected_shipping_title, raw_order,
      customers(name,email,phone,tax_id,tax_id_type),
      shipping_address:customer_addresses!orders_shipping_address_id_fkey(name,phone,address_line1,address_line2,city,state,postal_code,country),
      billing_address:customer_addresses!orders_billing_address_id_fkey(name,phone,address_line1,address_line2,city,state,postal_code,country)
    `)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  const shipmentByOrderId = await latestShipmentMapForOrders(supabase, [data.id]);
  const order = mapLegacyOrderRow(data, shipmentByOrderId.get(data.id));
  return {
    order,
    timeline: [
      {
        id: `${order.id}-wix-import`,
        event_type: 'wix_order_synced',
        old_value: '',
        new_value: order.internal_status,
        notes: 'Order details are synced from Wix production.',
        created_at: order.order_date,
        actor_name: 'Wix'
      }
    ],
    packingChecklist: [],
    tasks: [],
    notes: order.notes ? [{ id: `${order.id}-note`, body: order.notes, actor_name: 'Wix', created_at: order.order_date }] : [],
    attachments: [],
    shipments: []
  };
}

async function latestShipmentMapForOrders(supabase, orderIds) {
  const ids = orderIds.filter(Boolean);
  if (!ids.length) return new Map();
  const { data: rows, error } = await supabase
    .from('shipments')
    .select('id,order_id,status,waybill,courier_code,carrier_response,label_url,label_format,label_error,updated_at')
    .in('order_id', ids)
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (error) return new Map();
  const map = new Map();
  for (const row of rows || []) {
    if (!map.has(row.order_id)) map.set(row.order_id, row);
  }
  return map;
}

function mapLegacyOrderRow(row, shipment) {
  const mapped = mapOrderRow({
    ...row,
    source: 'wix',
    external_order_id: row.wix_order_id,
    internal_status: legacyInternalStatus(row),
    installation_status: 'not_contacted',
    installation_method: 'unknown',
    feedback_status: 'feedback_pending',
    shipment_status: row.shipment_status || shipment?.status || null,
    courier: row.shipment_courier_code || shipment?.courier_code,
    awb_number: row.shipment_waybill || shipment?.waybill,
    label_url: row.shipment_label_url || shipment?.label_url,
    label_format: row.shipment_label_format || shipment?.label_format,
    label_error: row.shipment_label_error || shipment?.label_error,
    tracking_url: trackingUrlFromShipment(row, shipment)
  });
  const raw = row.raw_order || {};
  const firstItem = raw.lineItems?.[0] || {};
  mapped.bike_model = mapped.bike_model || firstItem.descriptionLines?.find?.(line => /bike|model/i.test(line.name?.original || ''))?.plainText?.original || '';
  mapped.product_variant = mapped.product_variant || firstItem.productName?.original || firstItem.productName || '';
  mapped.quantity = mapped.quantity || firstItem.quantity || 1;
  return mapped;
}

function trackingUrlFromShipment(row, shipment) {
  const tracking = shipment?.carrier_response?.trackingInfo || {};
  if (tracking.trackingLink) return tracking.trackingLink;
  const awb = row.shipment_waybill || shipment?.waybill;
  const courier = row.shipment_courier_code || shipment?.courier_code;
  if (!awb) return '';
  if (courier === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(awb)}`;
  if (courier === 'usps') return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(awb)}`;
  if (courier === 'dtdc') return `https://trackcourier.io/track-and-trace/dtdc/${encodeURIComponent(awb)}`;
  if (courier === 'aramex') return `https://www.aramex.com/track/results?ShipmentNumber=${encodeURIComponent(awb)}`;
  if (courier === 'uniuni') return `https://www.uniuni.com/tracking/?no=${encodeURIComponent(awb)}`;
  if (courier === 'shiprocket') return `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}

function legacyInternalStatus(row) {
  if (row.status === 'CANCELED') return 'cancelled';
  if (!isPaidStatus(row.payment_status)) return 'not_paid';
  const shipmentStatus = row.shipment_status || '';
  const hasTracking = Boolean(row.shipment_waybill);
  if (shipmentStatus === 'delivered') return 'installation_pending';
  if (shipmentStatus === 'in-transit') return 'in_transit';
  if (shipmentStatus === 'pending-international') return 'shipment_booked';
  if (hasTracking) return 'shipment_booked';
  if (row.fulfillment_status === 'FULFILLED') return 'fulfilled_no_tracking';
  return 'awaiting_packing';
}

function isPaidStatus(status) {
  return ['PAID', 'APPROVED', 'paid', 'approved'].includes(status);
}

function isPaidActiveOrder(order) {
  return isPaidStatus(order.payment_status) && !['cancelled', 'not_paid', 'fulfilled_no_tracking'].includes(order.internal_status);
}

function mapOrderDetail(row) {
  const order = mapOrderRow(row);
  const payment = relationFirst(row.payment_refs);
  return {
    order,
    items: (row.order_items || []).map(item => ({
      id: item.id,
      sku: item.sku || '',
      product_name: item.product_name || '',
      quantity: item.quantity || 1,
      item_price: item.item_price || 0,
      total_price: item.total_price || 0,
      hsn_code: item.hsn_code || '',
      tax_info: item.tax_info || {},
      raw_line_item: item.raw_line_item || {}
    })),
    payment: payment ? {
      payment_status: payment.payment_status || '',
      payment_method: payment.payment_method || '',
      transaction_ref: payment.transaction_ref || '',
      paid_amount: payment.paid_amount || 0,
      refunded_amount: payment.refunded_amount || 0,
      authorized_amount: payment.authorized_amount || 0,
      currency: payment.currency || order.currency || 'INR',
      raw_payment: payment.raw_payment || {}
    } : null,
    timeline: (row.status_history || []).map(item => ({
      id: item.id,
      event_type: item.field_name,
      old_value: item.old_value,
      new_value: item.new_value,
      notes: item.notes,
      created_at: item.created_at,
      actor_name: item.actor_name
    })),
    packingChecklist: row.packing_checklists || [],
    tasks: row.tasks || [],
    notes: row.notes || [],
    attachments: row.attachments || [],
    shipments: row.shipments || []
  };
}

async function detectDuplicate(payload) {
  const existing = await listOrders({ limit: 500 });
  const day = String(payload.order_date || '').slice(0, 10);
  return existing.find(order => {
    const sameContact = (payload.phone && order.phone === payload.phone) || (payload.email && order.email === payload.email);
    const sameExternal = payload.external_order_id && order.external_order_id === payload.external_order_id;
    const sameOrder = sameContact && order.address_line1 === payload.address_line1 && order.product_variant === payload.product_variant && String(order.order_date || '').slice(0, 10) === day;
    return sameExternal || sameOrder;
  });
}

function validateShipmentPayload(payload) {
  const missing = [];
  if (!payload.phone) missing.push('Missing phone number');
  if (isIndiaCountry(payload.country) && !/^[1-9][0-9]{5}$/.test(String(payload.pincode || ''))) missing.push('Invalid pincode');
  if (!payload.address_line1) missing.push('Missing address line');
  if (!Number(payload.product_value)) missing.push('Missing product value');
  if (!Number(payload.weight_grams)) missing.push('Missing weight');
  if (!Number(payload.length_cm) || !Number(payload.width_cm) || !Number(payload.height_cm)) missing.push('Missing dimensions');
  return missing;
}

async function latestShipmentForOrder(supabase, orderId) {
  const { data, error } = await supabase
    .from('shipments')
    .select('*')
    .eq('order_id', orderId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function syncOrderLabelSummary(supabase, orderId, label) {
  await supabase
    .from('orders')
    .update({
      shipment_label_url: label.label_url || null,
      shipment_label_format: label.label_format || null,
      shipment_label_error: label.label_error || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);
}

function bookingOptionsForService(serviceCode = 'express') {
  if (serviceCode === 'surface') return { shippingMode: 'S' };
  if (serviceCode === 'reverse_pickup') return { shippingMode: 'E', reverse: true };
  if (serviceCode === 'dlv_saver') return { internationalService: 'DLV Saver' };
  if (serviceCode === 'deferred_express') return { internationalService: 'Deferred Express' };
  return { shippingMode: 'E' };
}

function configWithShipmentDefaults(config, payload, serviceOptions) {
  return {
    ...config,
    defaults: {
      ...config.defaults,
      weightGrams: Number(payload.weight_grams) || config.defaults.weightGrams,
      lengthCm: Number(payload.length_cm) || config.defaults.lengthCm,
      widthCm: Number(payload.width_cm) || config.defaults.widthCm,
      heightCm: Number(payload.height_cm) || config.defaults.heightCm,
      paymentMode: payload.payment_mode === 'COD' ? 'COD' : 'Prepaid',
      shippingMode: serviceOptions.shippingMode || config.defaults.shippingMode
    }
  };
}

function normalizeBookedShipmentStatus(status) {
  if (status === 'booked') return 'shipment_booked';
  if (status === 'pending-international') return 'pending-international';
  if (status === 'failed') return 'failed_delivery';
  return status || 'shipment_booked';
}

function inferLabelFormat(labelUrl) {
  return String(labelUrl || '').toLowerCase().includes('.pdf') ? 'pdf' : 'url';
}

function isIndiaCountry(country) {
  return ['IN', 'INDIA', ''].includes(String(country || 'IN').trim().toUpperCase());
}

function trackingUrlFor(courier, awb) {
  if (!awb) return '';
  if (courier === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(awb)}`;
  if (courier === 'shree_maruti') return `https://trackcourier.io/shree-maruti/${encodeURIComponent(awb)}`;
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}

function splitTags(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(',').map(tag => tag.trim()).filter(Boolean);
}

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function latestRelatedRecord(records) {
  if (!Array.isArray(records) || !records.length) return null;
  return [...records].sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))[0];
}

function relationFirst(value) {
  if (Array.isArray(value)) return latestRelatedRecord(value) || value[0] || null;
  return value || null;
}

function scalarStatus(value) {
  return Array.isArray(value) ? '' : value;
}

function pickAuditFields(row) {
  return {
    internal_status: row.internal_status,
    shipment_status: row.shipment_status,
    installation_status: row.installation_status,
    feedback_status: row.feedback_status,
    courier: row.courier,
    awb_number: row.awb_number
  };
}

function completionRate(orders, field, doneValue) {
  if (!orders.length) return 0;
  const done = orders.filter(order => Array.isArray(doneValue) ? doneValue.includes(order[field]) : order[field] === doneValue).length;
  return Math.round((done / orders.length) * 100);
}
