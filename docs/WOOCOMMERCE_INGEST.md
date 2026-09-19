# WooCommerce → Ops order ingest

Additive ingest path for **woocombot**. Legacy Wix sync remains for existing orders.

## Endpoint

`POST https://ops.holdmythrottle.com/api/integrations/woocommerce/orders`

### Auth

Set `WOO_OPS_INGEST_SECRET` in Ops shared `.env` (never commit the real value).

Send either:

- `x-ops-woo-secret: <WOO_OPS_INGEST_SECRET>`
- or `Authorization: Bearer <WOO_OPS_INGEST_SECRET>`

### Body

Raw WooCommerce REST order JSON (`order.created` / `order.updated`), or `{ "order": { ... } }`.

### Response

```json
{ "ok": true, "order_id": "<uuid>", "order_number": "12045", "created": true, "updated": false, "action": "created" }
```

Idempotent on `woo_order_id` (also `source=woocommerce` + `external_order_id`).

### Out of scope (this PR)

- Shiprocket booking
- Woo write-back of AWB
- Customer tracking email / WhatsApp (opsbot; fire only on picked_up)

### Example curl

```sh
curl -sS -X POST 'https://ops.holdmythrottle.com/api/integrations/woocommerce/orders' \
  -H 'content-type: application/json' \
  -H "x-ops-woo-secret: $WOO_OPS_INGEST_SECRET" \
  -d @woo-order.json
```

### Migration

Apply `supabase/migrations/016_woo_order_ingest.sql` (adds nullable unique `orders.woo_order_id`). Until applied, ingest falls back to `(source, external_order_id)`.
