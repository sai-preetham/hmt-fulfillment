-- Update default shipment settings to:
-- Domestic: 400g, 23*14*6 cm
-- International: 400g, 24*15*6 cm
insert into crm_settings (key, value, description)
values (
  'shipment_defaults',
  '{
    "domestic": {"weightGrams": 400, "lengthCm": 23, "widthCm": 14, "heightCm": 6},
    "international": {"weightGrams": 400, "lengthCm": 24, "widthCm": 15, "heightCm": 6},
    "paymentMode": "Prepaid",
    "domesticServiceCode": "express",
    "internationalServiceCode": "dlv_saver"
  }'::jsonb,
  'Default package dimensions, weight, and service selection used by CRM booking forms.'
)
on conflict (key) do update set
  value = jsonb_set(
    jsonb_set(
      crm_settings.value,
      '{domestic}',
      '{"weightGrams": 400, "lengthCm": 23, "widthCm": 14, "heightCm": 6}'::jsonb
    ),
    '{international}',
    '{"weightGrams": 400, "lengthCm": 24, "widthCm": 15, "heightCm": 6}'::jsonb
  );
