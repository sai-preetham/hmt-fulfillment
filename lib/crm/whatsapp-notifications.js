import { createServiceClient } from '../supabase/server.js';
import { getConfig } from '../../src/config.js';
import { sendChatwootShipmentConfirmation } from './chatwoot.js';

export async function sendPickupConfirmationOnce(order, shipment, options = {}) {
  const config = options.config || getConfig();
  if (!config.chatwoot?.shipmentConfirmationEnabled) return { skipped: true, reason: 'shipment-confirmations-disabled' };
  if (!order?.id || !shipment?.waybill) return { skipped: true, reason: 'missing-order-or-tracking-id' };
  const db = options.db || createServiceClient();
  if (!db) return { skipped: true, reason: 'missing-supabase-config' };
  const marker = `automation:whatsapp:shipment-confirmation:${shipment.waybill}`;
  const { data: existing, error: lookupError } = await db.from('notes').select('id').eq('order_id', order.id).eq('note_type', 'automation').eq('body', marker).maybeSingle();
  if (lookupError) throw new Error(`Could not check shipment-message history: ${lookupError.message}`);
  if (existing) return { skipped: true, reason: 'already-sent' };

  const sendImpl = options.sendImpl || sendChatwootShipmentConfirmation;
  const result = await sendImpl(order, shipment, {
    inboxId: config.chatwoot.inboxId,
    templateName: config.chatwoot.shipmentTemplateName,
    language: config.chatwoot.shipmentTemplateLanguage,
    category: config.chatwoot.shipmentTemplateCategory,
    trackingButtonUrl: config.chatwoot.shipmentTrackingButtonUrl,
    fetchImpl: options.fetchImpl,
    env: options.env
  });
  if (result.skipped) return result;
  const { error: noteError } = await db.from('notes').insert({ order_id: order.id, body: marker, note_type: 'automation', actor_name: 'WhatsApp automation' });
  if (noteError) throw new Error(`Shipment message sent but its duplicate guard could not be saved: ${noteError.message}`);
  await db.from('orders').update({
    chatwoot_conversation_id: result.conversationId,
    chatwoot_contact_id: result.contactId,
    last_message_type: 'shipment-confirmation',
    last_communication_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', order.id);
  return result;
}
