# Operator Test Cases

## Stage Option Coverage

These options must be visible on the order detail page, saved without changing spelling, and reflected in filters or queues where applicable.

### Order Status

1. `new`: order appears in New orders and can be packed after payment is confirmed.
2. `not_paid`: order is excluded from packing and shipment booking queues.
3. `details_verified`: operator can save verification completion and filter by Details verified.
4. `awaiting_packing`: paid order appears in packing queue.
5. `packed`: order is eligible for shipment booking.
6. `shipment_booked`: order shows courier/AWB/tracking actions.
7. `pickup_pending`: order appears in pickup pending workflow.
8. `in_transit`: order is excluded from packing and pickup-ready actions.
9. `delivered`: order becomes eligible for installation and feedback follow-up.
10. `installation_pending`: order appears in installation follow-up.
11. `feedback_pending`: order appears in feedback queue when delivered/installed.
12. `issue_reported`: order appears as an open issue.
13. `completed`: order leaves active operational queues.
14. `fulfilled_no_tracking`: order is treated as fulfilled outside tracked courier flow.
15. `cancelled`: order is excluded from active operational queues.
16. `rto`: order appears in RTO reporting.
17. `warranty_case`: order appears in issue/warranty workflow.

### Shipment Status

1. `not_booked`: no AWB required; order remains bookable when paid and active.
2. `booked`: AWB/tracking are shown and packing is no longer required.
3. `shipment_booked`: CRM booking state is visible in order table and detail.
4. `pickup_pending`: order appears in pickup queue.
5. `picked_up`: order leaves pickup-pending queue.
6. `in_transit`: order appears as in transit.
7. `in-transit`: legacy courier spelling is accepted and displayed.
8. `out_for_delivery`: order is not treated as delivered yet.
9. `delivered`: installation follow-up becomes available.
10. `failed_delivery`: issue/follow-up is flagged.
11. `rto_initiated`: RTO state is visible.
12. `rto_delivered`: RTO closure state is visible.
13. `lost_damaged`: issue escalation is visible.
14. `pending-international`: international booking is queued without domestic AWB creation.

### Installation Status And Method

1. `not_contacted`: default after delivery.
2. `guide_sent`: guide communication can be recorded.
3. `video_sent`: video communication can be recorded.
4. `customer_needs_help`: support follow-up is required.
5. `installation_scheduled`: scheduled install date/notes can be retained.
6. `installed_successfully`: feedback follow-up becomes due.
7. `installation_issue`: support issue can be created.
8. `returned_cancelled`: order leaves installation success workflow.
9. Method `unknown`: allowed default.
10. Method `diy`: saves without garage fields.
11. Method `hmt_bengaluru_store`: saves store install location.
12. Method `nearby_garage`: saves garage name, contact person, phone, email, address, city, state, and pincode.

### Feedback Status

1. `feedback_pending`: order appears in feedback queue when eligible.
2. `positive_feedback`: order remains available for review request.
3. `negative_feedback`: issue escalation remains available.
4. `review_requested`: review ask has been sent.
5. `review_received`: feedback workflow can close.
6. `ugc_received`: UGC/media received state is visible.
7. `issue_escalated`: support follow-up is required.

### Payment, Courier, And Booking Options

1. Payment statuses `PAID` and `APPROVED` allow packing/shipment workflows.
2. Payment statuses `NOT_PAID`, `PENDING`, `CANCELED`, `PARTIALLY_REFUNDED`, and `FULLY_REFUNDED` keep orders out of the paid packing list unless manually overridden.
3. Courier options present: Delhivery, FedEx, Shree Maruti, Shiprocket, DTDC, USPS, Aramex, UniUni, Wix, Manual.
4. Delhivery direct booking services present: Express, Surface, Reverse pickup, International DLV Saver, International Deferred Express.
5. FedEx and Shree Maruti are selectable for manual AWB storage; direct API booking must show a clear not-configured message until adapters are implemented.
6. Manual AWB save works for store pickup, customer pickup, local delivery, and any courier fulfilled outside the CRM.

## Order Flow

1. New Wix order is imported correctly: paid Wix order creates customer, address, order, items, timeline, and verify-order task.
2. New Amazon order is imported correctly: Amazon order has source `amazon`, external order ID, product details, and manual correction flags when data is incomplete.
3. Operator manually edits order details: customer, address, bike model, product variant, statuses, tags, and notes save and create `status_history`.
4. Duplicate order is detected: same phone/email, address, product, date, or external order ID blocks manual creation and shows suspected order.
5. Manual order is created: operator enters all required fields and order appears in New orders.

## Shipment Flow

1. Shipment can be booked via Delhivery: valid order stores courier, AWB, tracking URL, label, carrier response, and status.
2. FedEx direct booking option is handled honestly: until the FedEx adapter is configured, operator sees a not-configured message and can save a manual FedEx AWB.
3. Shree Maruti direct booking option is handled honestly: until the Shree Maruti adapter is configured, operator sees a not-configured message and can save a manual Shree Maruti AWB.
4. Shipment cannot be booked with missing address: validation lists missing address line.
5. AWB and tracking link are stored correctly: order row and detail page show AWB/tracking.
6. Label can be downloaded: label URL opens from order detail when present.
7. Operator can manually enter AWB: manual AWB updates shipment/order state without courier API dependency.

## Packing Flow

1. Operator completes packing checklist: all required kit items can be marked packed.
2. Packing photo can be uploaded: Supabase Storage URL is saved as attachment/packing photo.
3. Order moves to Packed: all checklist items complete updates internal status.
4. Order moves to Ready for Pickup: packed order can be moved into pickup queue after shipment booking.

## Tracking Flow

1. Courier webhook updates shipment status: webhook creates `courier_events`, updates `shipments`, and updates order status.
2. Delivered order automatically moves to Installation Pending: delivered webhook changes internal status.
3. Failed delivery is flagged: status appears in dashboard and task is created.
4. RTO order is flagged: RTO status appears in RTO filter and timeline.

## Installation Flow

1. Installation guide task is created after delivery: delivered order gets follow-up task.
2. Operator marks installation completed: installer, date, bike photo, notes, and status save.
3. Operator reports installation issue: order moves to issue reported and support task is created.
4. Feedback task is created after installation: installed order gets Day 14 feedback task.
5. Operator records DIY installation: installation method saves as DIY and no garage details are required.
6. Operator records Bengaluru store installation: installation method saves as Hold My Throttle Bengaluru store and install location is retained.
7. Operator records nearby garage installation: garage name, contact person, phone, email, address, city, state, and pincode save on the order.

## Support Flow

1. Operator can open Chatwoot conversation: existing conversation ID opens external Chatwoot URL.
2. Tracking link can be sent: communication button records last message type.
3. Installation guide can be sent: communication button records guide intent and timestamp.
4. Feedback request can be sent: communication button records feedback request.

## Permissions

1. Packing operator cannot edit payment/order value: direct Supabase RLS denies order value updates for packing role.
2. Support operator cannot book shipment: RLS/API guard denies shipment mutation for support role.
3. Admin can edit all fields: admin can update orders, users, integrations, shipments, installation, feedback, tasks, and notes.

## Edge Cases

1. Courier API is down: shipment booking failure creates `integration_errors` and order remains manually bookable.
2. Wix order has missing customer phone: order imports but validation blocks shipment booking until corrected.
3. Amazon order has incomplete address: order imports with correction task.
4. Same customer places two orders: duplicate detection allows genuinely different product/date combinations.
5. Order is cancelled after shipment booked: order status becomes cancelled and cancellation audit is retained.
6. Shipment is delivered but customer has not installed: installation status remains pending and follow-up tasks stay open.
7. Customer reports issue after installation: feedback escalates issue and creates support task/warranty case.
