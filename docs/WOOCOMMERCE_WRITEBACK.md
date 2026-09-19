# Ops → WooCommerce shipment write-back

When an Ops shipment is **booked** (AWB assigned) or **picked_up**, Ops writes carrier / AWB / tracking meta back to the linked WooCommerce order.

Ops owns shipments. Woo → Ops pull/ingest already exists. This path is the reverse: Ops → Woo meta only.

## Behaviour

| Event | Trigger | Woo action |
| --- | --- | --- |
| **booked** | Manual AWB save (`bookShipment` / `save_manual_awb`), courier book path via `syncBookedShipmentToWix` companion, automation channel sync for `source=woocommerce` | Upsert order `meta_data` with status `booked` |
| **picked_up** | Operator **Mark picked up** (`markShipmentPickedUp`) | Upsert same meta with status `picked_up` |

- Only orders with `source=woocommerce` and `woo_order_id` (or Woo `external_order_id`) are written.
- **Meta-only**: WC order `status` is **not** changed on booked or picked_up (avoids premature `completed`).
- **No** customer email / WhatsApp from this path.
- **Fail soft**: Woo errors are logged; Ops booking / pickup still succeeds.
- **Idempotent**: safe to retry; meta keys are upserted by key; `_hmt_ops_shipment_id` + `_hmt_ops_synced_at` support reconciliation.

## Feature flag (fail-closed)

```bash
WOO_SHIPMENT_WRITEBACK_ENABLED=true
# Reuse existing REST credentials:
WOO_BASE_URL=https://wp-staging.holdmythrottle.com   # or https://wp.holdmythrottle.com
WOO_CONSUMER_KEY=ck_...
WOO_CONSUMER_SECRET=cs_...
```

Default is off (`false` / unset). Enable on saipi after deploy; restart / redeploy Ops so the Next process picks up env.

## Woo meta keys (woocombot contract)

| Key | Value |
| --- | --- |
| `_hmt_carrier` | Lowercase slug: `delhivery` / `shiprocket` / `fedex` |
| `_hmt_awb` | AWB / waybill / tracking number |
| `_hmt_tracking_url` | Full public tracking URL |
| `_hmt_shipment_status` | Ops status string: `booked`, `picked_up`, … |
| `_hmt_ops_shipment_id` | Ops shipment UUID (idempotency) |
| `_hmt_ops_synced_at` | ISO timestamp of last write-back |

Do **not** use `_wc_shipment_tracking_items` (that plugin is not used).

## REST shape (example)

```bash
curl -fsS -X PUT \
  'https://wp-staging.holdmythrottle.com/wp-json/wc/v3/orders/12345' \
  -u "$WOO_CONSUMER_KEY:$WOO_CONSUMER_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "meta_data": [
      { "key": "_hmt_carrier", "value": "delhivery" },
      { "key": "_hmt_awb", "value": "1234567890" },
      { "key": "_hmt_tracking_url", "value": "https://www.delhivery.com/track/package/1234567890" },
      { "key": "_hmt_shipment_status", "value": "booked" },
      { "key": "_hmt_ops_shipment_id", "value": "00000000-0000-0000-0000-000000000001" },
      { "key": "_hmt_ops_synced_at", "value": "2026-09-19T12:00:00.000Z" }
    ]
  }'
```

Note: no `"status"` field in the body.

## Code map

- Client helpers: `src/woocommerce.js` (`buildHmtShipmentMetaData`, `updateWooCommerceOrderShipmentMeta`)
- Sync orchestration: `src/wooShipmentSync.js`
- Call sites: `lib/crm/data.js` (`finishManualShipmentSave`, `markShipmentPickedUp`), `src/booking.js` (`syncBookedShipmentToWix` companion), `lib/crm/automation.js` (Woo branch of channel sync)

## Operator enable steps (saipi)

1. Merge / deploy this branch to Ops on saipi.
2. In shared `.env` set `WOO_SHIPMENT_WRITEBACK_ENABLED=true` (credentials should already exist for pull sync).
3. Restart Ops / redeploy so env is loaded.
4. Smoke: book or save AWB on a Woo-sourced Ops order → confirm meta on the WC order; mark picked up → `_hmt_shipment_status=picked_up`.
5. If Woo is down, Ops booking/pickup still succeeds; check Ops logs for `[woo-shipment-writeback]`.

See also: `docs/WOOCOMMERCE_ORDER_SYNC.md` (pull), `docs/WOOCOMMERCE_INGEST.md` (push ingest).
