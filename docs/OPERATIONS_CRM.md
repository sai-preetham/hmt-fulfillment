# Hold My Throttle Operations CRM

## Database Schema

Apply existing migrations plus `supabase/migrations/004_operations_crm.sql`.

Core tables:

- `users`: operator profile, Supabase Auth link, role, active flag.
- `customers`, `customer_addresses`: source-independent customer state.
- `orders`: Wix, Amazon, and manual orders with internal status, shipment status, installation status, feedback status, Chatwoot refs, tags, notes, courier, AWB, and package data.
- `order_items`: product lines, variants, SKU, quantity, price, HSN, tax metadata.
- `shipments`: courier booking state, AWB, package dimensions, label, carrier response.
- `courier_events`: normalized courier webhooks/polling events.
- `packing_checklists`: per-order checklist items.
- `installation_status`: install outcome, installation method, installer, date, bike photo, issue linkage, and garage contact details.
- `feedback`: feedback, review, UGC, issue escalation.
- `tasks`: operator work queue.
- `notes`: internal comments and customer/support notes.
- `status_history`: audit trail for status and field changes.
- `attachments`: Supabase Storage object refs for labels, invoices, packing photos, bike photos.
- `integrations`: provider configs/status.
- `integration_errors`: visible sync/webhook/API failures.
- `courier_accounts`: courier account and pickup configuration.

RLS is enabled on CRM tables. `authenticated` receives explicit grants because new Supabase projects may not expose public tables to the Data API automatically. The app uses server-side service role access for API routes; browser access should use Supabase Auth sessions with `AUTH_REQUIRED=true`.

## API Structure

CRM API routes:

- `GET /api/crm/dashboard`
- `GET /api/crm/orders`
- `POST /api/crm/orders`
- `GET /api/crm/orders/:id`
- `PATCH /api/crm/orders/:id`
- `POST /api/crm/orders/:id/shipment`
- `POST /api/crm/orders/:id/packing`
- `POST /api/crm/orders/:id/communication`
- `GET /api/crm/tasks`
- `GET /api/crm/integration-errors`

Integration-ready routes:

- `POST /api/integrations/wix/sync`
- `POST /api/integrations/amazon/sync`
- `POST /api/webhooks/couriers/:courier`

Existing legacy routes remain in `src/server.js` and can be run with `npm run legacy:dev`.

## Frontend Structure

Pages:

- `/`: dashboard
- `/orders`: search, filters, manual creation
- `/orders/[id]`: editable order, timeline, packing, shipment, Chatwoot actions
- `/packing`: packing queue
- `/shipments`: shipment booking queue
- `/pickup`: pickup pending queue
- `/installation`: installation follow-up
- `/feedback`: feedback/review queue
- `/tasks`: operator task board
- `/integration-errors`: failed sync/webhook/API page
- `/settings`: roles, courier, auth, integration readiness
- `/login`: Supabase email/password sign-in

Components:

- `AppShell`
- `OrderTable`
- `OrderFilters`
- `OrderDetailForm`
- `ShipmentForm`
- `PackingForm`
- `ManualOrderForm`
- `StatusPill`

## Integration Architecture

All integrations normalize external state into Supabase first. The UI reads Supabase, not Wix, Amazon, Chatwoot, or courier dashboards.

Wix:

- Pull paid orders and upsert `customers`, `customer_addresses`, `orders`, `order_items`.
- Preserve `wix_order_id`, `external_order_id`, raw payload versions, fulfillment status.
- After shipment booking, push AWB/tracking details back to Wix.
- Store failures in `integration_errors`.

Amazon:

- Pull SP-API order/product/customer-safe fields.
- Store source as `amazon` and external order ID.
- Incomplete address/phone data is flagged for manual correction.
- Duplicate checks compare phone, email, address, product, order date, external ID.

Couriers:

- Adapter boundary: Delhivery, FedEx, Shree Maruti.
- Booking validates phone, pincode, address line, product value, weight, dimensions.
- Booking stores AWB, tracking URL, label, invoice URL, pickup date, carrier response.
- Webhooks/polling write `courier_events` and update shipment/order statuses.

Chatwoot:

- CRM stores contact/conversation IDs and last communication metadata.
- Operators open Chatwoot externally.
- CRM buttons record intent for tracking link, installation guide/video, feedback request, and review request.

## Operator Workflow

1. New orders arrive from Wix/Amazon/manual creation.
2. Operator verifies customer, address, bike, product variant, payment, and duplicate risk.
3. Packing operator completes checklist, uploads photo, enters package dimensions/weight.
4. Operations books courier shipment or manually adds AWB.
5. Pickup queue tracks ready, pending, failed pickup, and manual override cases.
6. Courier webhooks/polling update in-transit, OFD, delivered, failed, RTO, lost/damaged.
7. Delivery triggers installation pending and follow-up tasks.
8. Support records whether installation was DIY, at the Hold My Throttle Bengaluru store, or at a nearby garage.
9. For garage installs, support captures garage name, contact person, phone, email, address, city, state, and pincode.
10. Support sends guide/video, marks installation outcome, or creates an issue.
11. Feedback workflow creates Day 3, 7, 14, 30 follow-up tasks.
12. Completed orders retain timeline, notes, attachments, courier events, feedback, and support history.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

Apply Supabase schema:

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

Required production env:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_REQUIRED=true`
- `CHATWOOT_BASE_URL`
- `CHATWOOT_ACCOUNT_ID`
- Wix, Amazon, Delhivery, FedEx, Shree Maruti credentials as needed.

## Deployment

1. Create Supabase project and run migrations.
2. Create Supabase Auth users for operators.
3. Insert matching rows in `users` with `auth_user_id` and role.
4. Create `crm-attachments` storage bucket using migration.
5. Add env vars in Vercel.
6. Deploy with Vercel using `npm run build`.
7. Configure Wix/Amazon sync cron or scheduled Vercel function.
8. Configure courier webhook URLs to `/api/webhooks/couriers/:courier`.

## Roadmap

- Replace placeholder Wix/Amazon route bodies with full adapters using existing `src/wix.js` and Amazon SP-API.
- Add signed Supabase Storage upload widgets.
- Add role-aware server-side guards inside CRM API routes.
- Add Vercel Cron for courier polling and follow-up task creation.
- Add bulk order import reconciliation screen.
- Add SLA alerts for stuck statuses.
- Add analytics exports for shipment cost, courier SLA, install rate, feedback rate, warranty rate.
