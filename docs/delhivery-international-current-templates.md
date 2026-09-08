# Delhivery International: current CSB V commercial templates

These profiles were downloaded fresh from the signed-in Delhivery One bulk-upload page on 2026-07-23. They replace any earlier local samples.

| Destination | DLV Premium | DLV Saver |
| --- | --- | --- |
| United States | `us-dlv-premium-csb-v-2026-07-23.xlsx` (83 columns) | `us-dlv-saver-csb-v-2026-07-23.xlsx` (50 columns) |
| Australia | `australia-dlv-premium-csb-v-2026-07-23.xlsx` (83 columns) | `australia-dlv-saver-csb-v-2026-07-23.xlsx` (50 columns) |
| Germany (EU representative) | `germany-dlv-premium-csb-v-2026-07-23.xlsx` (83 columns) | `germany-dlv-saver-csb-v-2026-07-23.xlsx` (49 columns) |
| Sweden | `sweden-dlv-premium-csb-v-2026-07-23.xlsx` (83 columns) | — |

The portal displays the clearance type as `CSB V`; this is the CSB5 commercial flow requested. Each template was generated with FOB defaults. The destination-specific difference found in this matrix is the DLV Saver Germany template: it has no `Street Address 2` column. Premium is the same 83-column layout across these three downloads, but its row must set `service_type*^` to `EXPORTS_EXPRESS` and `consignee_country*^` to the selected country.

## CSV endpoint

Use the CSV route only with an explicit current service and country profile:

```text
GET /api/international/export?format=csv&service=saver&country=US
GET /api/international/export?format=csv&service=saver&country=AU
GET /api/international/export?format=csv&service=saver&country=DE
GET /api/international/export?format=csv&service=premium&country=US
GET /api/international/export?format=csv&service=premium&country=SE
```

For Premium, populate `delhivery.international` (or the matching `DELHIVERY_INTERNATIONAL_*` environment variables) with your account's `clientName`, `pickupWarehouseId`, `hsnCode`, shipper KYC/bank data, and dimensions. EWBN remains optional and is required only where the consignment value requires it. The response includes `X-Delhivery-Validation-Errors`; it can still download a CSV, but any reported errors must be corrected before portal upload.

## Live portal flow checked

1. In **International Orders → Bulk Upload**, choose destination country, `DLV Premium` or `DLV Saver`, `CSB V`, and seller.
2. Click **Download Custom Excel Template**. This selection controls the layout; do not reuse a template from another country/service combination.
3. Upload the generated CSV/XLSX and use **Upload & Verify**. Resolve the portal's validation errors before submitting a shipment.
4. Once verified, proceed through the portal's order/pickup workflow. A live submission was intentionally not performed during this check because it can create a chargeable production shipment.
