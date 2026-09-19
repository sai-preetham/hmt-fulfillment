# WooCommerce → Ops order pull/sync

Ops-native pull of WooCommerce orders into Hold My Throttle Ops CRM, mirroring Wix/Amazon sync.

Push ingest (`POST /api/integrations/woocommerce/orders` with `x-ops-woo-secret`) remains available for optional webhooks.

## Enable on saipi (shared `.env`)

Fail-closed: sync does nothing unless explicitly enabled.

```bash
WOO_ORDER_SYNC_ENABLED=true
WOO_BASE_URL=https://wp-staging.holdmythrottle.com   # or https://wp.holdmythrottle.com
WOO_CONSUMER_KEY=ck_...
WOO_CONSUMER_SECRET=cs_...
WOO_ORDER_SYNC_INTERVAL_MINUTES=15
WOO_ORDER_SYNC_PAGE_SIZE=25
WOO_ORDER_SYNC_MAX_PAGES=3
```

Do not commit real secrets. Restart / redeploy Ops after changing env so the Next process picks them up.

## Automatic schedule

The existing `wixdelhivery-automation.timer` (every ~15 minutes) hits `POST /api/automation/run`, which now also runs Woo sync when enabled.

## Manual trigger

```bash
curl -fsS -X POST 'https://ops.holdmythrottle.com/api/integrations/woocommerce/sync' \
  -H "Authorization: Bearer $AUTOMATION_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"manual","force":true}'
```

Same header pattern as Wix automation / `POST /api/automation/run`.

Status (no secrets):

```bash
curl -fsS 'https://ops.holdmythrottle.com/api/integrations/woocommerce/sync' \
  -H "Authorization: Bearer $AUTOMATION_SECRET"
```

Authenticated Ops UI sessions can also POST without the bearer (proxy session auth).

## Behaviour

- `GET /wp-json/wc/v3/orders` with Basic auth (`WOO_CONSUMER_KEY:WOO_CONSUMER_SECRET`)
- Bounded by `modified_after` watermark + `WOO_ORDER_SYNC_MAX_PAGES`
- Upserts via existing `upsertWooCommerceOrder(s)` (`source=woocommerce`, `woo_order_id`)
- Returns pulled / persisted / created / updated / error counts

## Migration

- `016_woo_order_ingest.sql` — non-partial unique index on `orders.woo_order_id`
- `017_woo_order_id_unique_nonpartial.sql` — converts any already-applied partial index

Apply on Ops Supabase if not already applied.
