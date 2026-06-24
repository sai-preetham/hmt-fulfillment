insert into users(email, full_name, role)
values
  ('admin@holdmythrottle.example', 'Admin Operator', 'admin'),
  ('ops@holdmythrottle.example', 'Operations Manager', 'operations_manager'),
  ('packing@holdmythrottle.example', 'Packing Operator', 'packing_operator'),
  ('support@holdmythrottle.example', 'Support Operator', 'support_operator')
on conflict(email) do update set full_name = excluded.full_name, role = excluded.role, active = true;

insert into customers(name, email, phone)
values
  ('Arjun Mehta', 'arjun@example.com', '+91 98765 43210'),
  ('Sneha Kulkarni', 'sneha@example.com', '+91 99887 76655'),
  ('Rohan Dsouza', 'rohan@example.com', '+91 90909 11223')
on conflict(email) do update set name = excluded.name, phone = excluded.phone;

with c as (
  select id, email from customers where email in ('arjun@example.com', 'sneha@example.com', 'rohan@example.com')
)
insert into customer_addresses(customer_id, address_type, name, phone, address_line1, city, state, postal_code, country)
select id, 'shipping', 'Arjun Mehta', '+91 98765 43210', '22 Indiranagar 12th Main', 'Bengaluru', 'Karnataka', '560038', 'IN' from c where email = 'arjun@example.com'
union all
select id, 'shipping', 'Sneha Kulkarni', '+91 99887 76655', 'A-503 Green Park Society', 'Pune', 'Maharashtra', '411045', 'IN' from c where email = 'sneha@example.com'
union all
select id, 'shipping', 'Rohan Dsouza', '+91 90909 11223', 'Villa 14, Miramar Road', 'Panaji', 'Goa', '403001', 'IN' from c where email = 'rohan@example.com';

with arjun as (
  select c.id customer_id, a.id address_id from customers c join customer_addresses a on a.customer_id = c.id where c.email = 'arjun@example.com' limit 1
), sneha as (
  select c.id customer_id, a.id address_id from customers c join customer_addresses a on a.customer_id = c.id where c.email = 'sneha@example.com' limit 1
), rohan as (
  select c.id customer_id, a.id address_id from customers c join customer_addresses a on a.customer_id = c.id where c.email = 'rohan@example.com' limit 1
)
insert into orders(wix_order_id, external_order_id, order_number, source, customer_id, shipping_address_id, payment_status, total_amount, currency, source_created_at, internal_status, shipment_status, installation_status, feedback_status, bike_model, product_variant, quantity, assigned_operator, tags, notes)
select 'wix-10091', 'WIX-10091', '10091', 'wix', customer_id, address_id, 'paid', 12999, 'INR', now(), 'awaiting_packing', 'not_booked', 'not_contacted', 'feedback_pending', 'Royal Enfield Himalayan 450', 'HMT Cruise Kit - Himalayan 450', 1, 'Nisha', array['wix','priority'], 'Customer requested WhatsApp tracking update.' from arjun
union all
select null, 'AMZ-406-2281443', 'AMZ-2281443', 'amazon', customer_id, address_id, 'paid', 13999, 'INR', now() - interval '2 days', 'pickup_pending', 'pickup_pending', 'not_contacted', 'feedback_pending', 'KTM Adventure 390', 'HMT Cruise Kit - KTM 390 Adv', 1, 'Ravi', array['amazon'], 'Amazon address corrected manually.' from sneha
union all
select null, 'MAN-10072', 'MAN-10072', 'manual', customer_id, address_id, 'paid', 14999, 'INR', now() - interval '6 days', 'installation_pending', 'delivered', 'guide_sent', 'feedback_pending', 'Triumph Scrambler 400X', 'HMT Cruise Kit - Scrambler 400X', 1, 'Anika', array['manual','install-help'], 'Needs video install guide in English.' from rohan
on conflict(source, external_order_id) do update set internal_status = excluded.internal_status, shipment_status = excluded.shipment_status, updated_at = now();

insert into tasks(title, assigned_operator, due_date, priority, status, notes, order_id)
select 'Verify new Wix order', 'Nisha', now(), 'high', 'open', 'Confirm bike model and address before packing.', id from orders where external_order_id = 'WIX-10091'
union all
select 'Follow up after failed pickup', 'Ravi', now(), 'medium', 'in_progress', 'Courier pickup pending since yesterday.', id from orders where external_order_id = 'AMZ-406-2281443'
union all
select 'Send installation video', 'Anika', now() + interval '1 day', 'medium', 'open', 'Customer asked for English guide.', id from orders where external_order_id = 'MAN-10072';
