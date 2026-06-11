-- Migration 003: Add dedup index on shipment_events for tracking polling
-- The shipment_events table was created in migration 001. This adds a unique
-- index so repeated tracking polls cannot insert duplicate scan events.

create unique index if not exists idx_shipment_events_dedup
  on shipment_events (shipment_id, occurred_at, event_status);
