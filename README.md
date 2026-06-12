# Hold My Throttle Operations CRM

This repository now contains a Next.js internal Operations CRM for Hold My Throttle plus the legacy Wix/Delhivery shipment service.

The CRM manages orders from Wix, Amazon, and manual entry; fulfillment; packing; shipment booking; pickup and delivery tracking; installation follow-up; feedback; reviews; support; tasks; integration errors; and audit history in Supabase.

Detailed deliverables:

- [Operations CRM architecture](docs/OPERATIONS_CRM.md)
- [Operator test cases](docs/OPERATOR_TEST_CASES.md)

## Run the CRM

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`.

The CRM runs with seeded demo data when Supabase env vars are missing. Set these for persistence:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AUTH_REQUIRED=true
```

Apply schema:

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

Sync all Wix orders and Wix fulfillment tracking details into Supabase:

```bash
npm run sync:wix-crm
```

The sync walks Wix order search cursors, persists every order, and for fulfilled/partially fulfilled orders calls Wix fulfillments to store AWB, courier, and tracking links when present. Use a smaller page size if Wix is slow:

```bash
WIX_SYNC_PAGE_SIZE=25 npm run sync:wix-crm
```

## Next.js CRM Routes

- `/` dashboard
- `/orders`
- `/orders/[id]`
- `/packing`
- `/shipments`
- `/pickup`
- `/installation`
- `/feedback`
- `/tasks`
- `/integration-errors`
- `/settings`

## Legacy Shipment Service

Run the previous Node service with:

```bash
npm run legacy:dev
```

It still serves the older shipping dashboard and APIs from `src/server.js`.

## Legacy Service Notes

## What It Does

- Receives Wix `Order Created` webhooks at `POST /webhooks/wix/orders/created`.
- Fetches the full order from Wix with `GET https://www.wixapis.com/ecom/v1/orders/{id}` when only an order ID is supplied.
- Pulls recent Wix orders with `POST https://www.wixapis.com/ecom/v1/orders/search`.
- Uses Delhivery Express/Air mode by default via `DEFAULT_SHIPPING_MODE=Express`.
- Books shipments through Delhivery by default and creates an AWB. Set `CREATE_AWB_ON_BOOK=false` only when you want the app to queue orders without calling Delhivery.
- Detects international Wix orders and maps selected Wix shipping method to a Delhivery international service.
- Supports domestic reverse pickup booking by sending Delhivery `payment_mode=Pickup`.
- Creates Delhivery shipments using:
  - staging: `https://staging-express.delhivery.com/api/cmu/create.json`
  - production: `https://track.delhivery.com/api/cmu/create.json`
- Stores booking attempts in `data/shipments.json`.
- Provides a local dashboard at `http://localhost:3000`.

The integration follows the current Wix and Delhivery docs: Wix sends order-created webhook data as a JWT and exposes the Get Order endpoint at `/ecom/v1/orders/{id}`; Delhivery's create-order API requires `format=json&data=...` and a registered, case-sensitive pickup location name.

Sources:
- [Wix Order Created webhook](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/order-created)
- [Wix Get Order API](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/get-order)
- [Delhivery Package Order Creation API](https://delhivery-express-api-doc.readme.io/reference/order-creation-api)

## Run Locally

```bash
cp .env.example .env
# Fill in DELHIVERY_API_TOKEN and DELHIVERY_PICKUP_LOCATION.
# Fill in WIX_AUTH_TOKEN and WIX_SITE_ID if you want to pull orders from Wix.
npm start
```

If `npm` is not installed in your environment, run:

```bash
node src/server.js
```

Open `http://localhost:3000`.

## Wix Setup

Create a Wix app/webhook subscription for eCommerce `Order Created` and point it at:

```text
https://your-domain.example/webhooks/wix/orders/created
```

For local testing, expose this server with a tunnel and set the tunnel URL as the webhook URL.

By default, webhooks are stored but not automatically booked. Set:

```text
AUTO_BOOK_WIX_WEBHOOKS=true
```

to book shipments as soon as Wix sends a valid order event.

## AWB Creation

The app defaults to calling Delhivery's package API and creating an AWB:

```text
CREATE_AWB_ON_BOOK=true
```

Set this to `false` only when you want the app to keep orders in a local pending queue.

If you use a Wix API key as `WIX_AUTH_TOKEN`, Wix also requires `WIX_SITE_ID` for eCommerce order calls. The site ID is in the Wix dashboard URL after `/dashboard/`.

## Useful API Endpoints

```text
GET  /health
GET  /api/couriers
GET  /api/shipments
GET  /api/wix/orders
POST /api/book-from-wix
POST /api/book-manual
POST /webhooks/wix/orders/created
```

## Supabase Fulfillment Store

Apply the schema in `supabase/migrations/001_fulfillment_schema.sql`, then set:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

When these values are present, the app writes orders, customers, shipments, attempts, and audit records to Supabase. Without them, it keeps using `data/shipments.json`.

Import existing local shipment records after Supabase is configured:

```bash
npm run import:shipments
```

Backfill all Wix orders into Supabase after Supabase is configured:

```bash
npm run backfill:wix-orders
```

Keep Supabase orders updated automatically by enabling the background Wix sync:

```text
WIX_ORDER_SYNC_ENABLED=true
WIX_ORDER_SYNC_INTERVAL_MINUTES=5
WIX_ORDER_SYNC_PAGE_SIZE=25
WIX_ORDER_SYNC_MAX_PAGES=1
WIX_REQUEST_TIMEOUT_SECONDS=30
```

The sync sorts Wix orders by `updatedDate` and upserts the newest pages into Supabase on each interval. Check or trigger it manually:

```bash
curl http://localhost:3000/api/sync/wix-orders
curl -X POST http://localhost:3000/api/sync/wix-orders
```

Courier partners are selected through an adapter layer. Delhivery is active; Shree Maruti is scaffolded and returns explicit not-configured errors until credentials and API schema are added.

Pull recent paid, unfulfilled Wix orders:

```bash
curl 'http://localhost:3000/api/wix/orders?limit=25&paymentStatus=PAID&fulfillmentStatus=NOT_FULFILLED'
```

Check the Delhivery Express/Air rate for a destination pincode:

```bash
curl 'http://localhost:3000/api/delhivery/rate?pin=411046&mode=E&weight=400'
```

Delhivery shipping mode defaults to Express/Air:

```text
DEFAULT_SHIPPING_MODE=Express
```

Use `DEFAULT_SHIPPING_MODE=Surface` only when you want surface shipments.

International Wix shipping method mapping:

```text
Wix method containing "express"  -> Delhivery Deferred Express
Wix method containing "standard" -> Delhivery DLV Saver
```

International orders are kept pending/no-AWB in this app until your Delhivery account provides an enabled international order creation API endpoint.

International cost display uses Delhivery's account-enabled rate API if you provide one later. Until then, configure a local rate card:

```text
INTERNATIONAL_RATE_CARD_JSON={"US":{"Deferred Express":[{"uptoGrams":500,"amount":1200,"tatDays":"5-8"}],"DLV Saver":[{"uptoGrams":500,"amount":900,"tatDays":"8-12"}]}}
```

Manual Wix booking:

```bash
curl -X POST http://localhost:3000/api/book-from-wix \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"WIX_ORDER_ID"}'
```

Manual shipment booking:

```bash
curl -X POST http://localhost:3000/api/book-manual \
  -H 'Content-Type: application/json' \
  -d @examples/manual-order.json
```

## Notes Before Production

- Use HTTPS for the webhook endpoint.
- Set `WIX_WEBHOOK_PUBLIC_KEY` or `WIX_WEBHOOK_SECRET` if your Wix webhook signing configuration exposes one.
- Confirm your exact Delhivery account-required fields, especially GST, HSN, pickup location, dimensions, and COD behavior.
- For shipments over INR 50,000, Delhivery requires an e-way bill value in the payload.
