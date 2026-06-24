create table if not exists crm_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table crm_settings enable row level security;

grant select on crm_settings to authenticated, service_role;
grant insert, update, delete on crm_settings to authenticated, service_role;

drop policy if exists "crm users can view settings" on crm_settings;
create policy "crm users can view settings" on crm_settings
for select to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));

drop policy if exists "ops managers can manage settings" on crm_settings;
create policy "ops managers can manage settings" on crm_settings
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager')));

insert into crm_settings(key, value, description)
values
  (
    'shipment_defaults',
    '{
      "domestic": {"weightGrams": 400, "lengthCm": 23, "widthCm": 14, "heightCm": 6},
      "international": {"weightGrams": 400, "lengthCm": 24, "widthCm": 15, "heightCm": 6},
      "paymentMode": "Prepaid",
      "domesticServiceCode": "express",
      "internationalServiceCode": "dlv_saver"
    }'::jsonb,
    'Default package dimensions, weight, and service selection used by CRM booking forms.'
  ),
  (
    'pickup_defaults',
    '{
      "pickupLocation": "Hold My Throttle HQ",
      "pickupPincode": "",
      "returnName": "",
      "returnAddress": "",
      "returnCity": "",
      "returnState": "",
      "returnPincode": "",
      "returnPhone": "",
      "sellerGstTin": "",
      "hsnCode": ""
    }'::jsonb,
    'Pickup, return, GST, and HSN defaults used for shipment booking.'
  ),
  (
    'international_export_defaults',
    '{
      "shipmentType": "Commercial",
      "purposeOfBooking": "Gift",
      "invoiceTerms": "FOB",
      "productCategory": "",
      "htsCode": "",
      "productDescription": "Hold My Throttle"
    }'::jsonb,
    'Defaults used for international shipment export sheets.'
  ),
  (
    'automation_defaults',
    '{
      "wixFulfillmentSyncEnabled": true,
      "trackingEnabled": false,
      "trackingIntervalMinutes": 30,
      "trackingBatchSize": 25
    }'::jsonb,
    'Non-secret automation defaults visible in CRM settings.'
  )
on conflict (key) do nothing;
