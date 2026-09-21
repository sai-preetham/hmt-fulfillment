# WooCommerce abandoned-cart recovery

Ops imports WooCommerce `checkout-draft` orders into the shared abandoned-cart queue. Drafts are eligible after the configured inactivity period (60 minutes by default).

## Rollout

1. Apply `supabase/migrations/018_woocommerce_abandoned_carts.sql` manually. App deployment does not run database migrations.
2. Confirm the WooCommerce API credentials can read `checkout-draft` orders.
3. Set `WOO_ABANDONED_CART_SYNC_ENABLED=true`.
4. Leave `WOO_ABANDONED_CART_WHATSAPP_ENABLED=false` until the approved Meta template button accepts the WooCommerce checkout URL.
5. Configure the approved template name, language, category, and exact dynamic-button URL, then enable WhatsApp sending.

The sender uses a database claim function so overlapping manual and scheduled syncs cannot send the same cart twice. Failed or skipped attempts remain retryable; sent carts are not selected again.

## Current Meta template limitation

The approved `abandoned_cart` template uses this dynamic button:

`https://www.holdmythrottle.com/product-page/{{1}}`

That button accepts a product-page slug, not a WooCommerce `payment_url`. The sender deliberately skips incompatible checkout URLs instead of sending a broken button. To send shoppers directly back to their abandoned checkout, approve a template whose dynamic URL base matches the public WooCommerce checkout URLs, then set `WHATSAPP_ABANDONED_CART_BUTTON_URL` to that exact URL including `{{1}}`.
