-- 0003: customers, orders, order lines, payments, reservations, delivery fees and settings.
-- Rule 1: an order's figures add up, enforced by the database as well as by pricing.ts. Rule 6:
-- order, payment and fulfilment are three separate state columns, each limited to its allowed set.
-- Decision 0002: order numbers are 'D' followed by a sequence starting at 10001; the confirmation
-- window is 48 hours; every governorate starts at a placeholder delivery fee of EGP 70.

-- Order numbers are also Bosta's reference later, so they are generated here and never reused.
create sequence order_number_seq start 10001;

-- The 27 governorates of Egypt. The codes match GOVERNORATES in governorates.ts (a test pins it).
create table governorate_delivery (
  governorate text primary key,
  fee_piastres int not null check (fee_piastres >= 0),
  cod_enabled boolean not null default true,
  -- True until M2's per-governorate settings replace the flat EGP 70.
  placeholder boolean not null default true
);

insert into governorate_delivery (governorate, fee_piastres, cod_enabled, placeholder)
select code, 7000, true, true
  from unnest(array[
    'cairo', 'giza', 'alexandria', 'qalyubia', 'port-said', 'suez', 'damietta', 'dakahlia', 'sharqia',
    'gharbia', 'monufia', 'beheira', 'kafr-el-sheikh', 'ismailia', 'faiyum', 'beni-suef', 'minya', 'asyut',
    'sohag', 'qena', 'luxor', 'aswan', 'red-sea', 'new-valley', 'matrouh', 'north-sinai', 'south-sinai'
  ]) as code;

create table settings (
  key text primary key,
  value jsonb not null
);

insert into settings (key, value) values ('cod_confirmation_window_hours', '48');

-- A customer is the normalised Egyptian mobile number (+201XXXXXXXXX).
create table customers (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+201[0125][0-9]{8}$'),
  name text not null,
  email text,
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('D' || nextval('order_number_seq')),
  -- The idempotency key of the checkout request: a retry finds the order instead of making another.
  checkout_key uuid not null unique,
  customer_id uuid not null references customers (id),
  recipient_name text not null,
  recipient_phone text not null,
  governorate text not null references governorate_delivery (governorate),
  area text not null,
  street text not null,
  building text not null,
  landmark text,
  lang text not null check (lang in ('ar', 'en')),
  direction text not null,
  channel text not null check (channel in ('web', 'manual')),
  payment_method text not null check (payment_method in ('cod')),
  subtotal int not null check (subtotal >= 0),
  discount_total int not null check (discount_total >= 0),
  delivery_fee int not null check (delivery_fee >= 0),
  total int not null check (total >= 0),
  order_state text not null check (order_state in ('pending', 'confirmed', 'cancelled')),
  payment_state text not null check (payment_state in ('awaiting_collection', 'voided')),
  fulfilment_state text not null check (fulfilment_state in ('unfulfilled')),
  -- Bumped by every state change (conditional update from the allowed states).
  version int not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  constraint orders_discount_within_subtotal check (discount_total <= subtotal),
  constraint orders_total_matches check (total = subtotal - discount_total + delivery_fee)
);
create index orders_customer_idx on orders (customer_id);
create index orders_created_at_idx on orders (created_at desc);

-- Lines keep the SKU, names and price as they were when the order was placed.
create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  variant_id uuid not null references variants (id),
  sku text not null,
  name_ar text not null,
  name_en text not null,
  unit_price int not null check (unit_price >= 0),
  quantity int not null check (quantity between 1 and 10),
  line_discount int not null,
  line_total int not null check (line_total >= 0),
  constraint order_lines_discount_range check (line_discount between 0 and unit_price * quantity),
  constraint order_lines_total_matches check (line_total = unit_price * quantity - line_discount)
);
create index order_lines_order_idx on order_lines (order_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  method text not null check (method in ('cod')),
  amount int not null check (amount >= 0),
  state text not null check (state in ('awaiting_collection', 'voided')),
  attempt int not null default 1 check (attempt >= 1),
  provider_ref text,
  unique (order_id, attempt)
);

-- Stock held for a pending order until it is confirmed, cancelled or its window ends.
create table reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  variant_id uuid not null references variants (id),
  quantity int not null check (quantity > 0),
  status text not null check (status in ('held', 'consumed', 'released')),
  expires_at timestamptz not null
);
create index reservations_order_idx on reservations (order_id);
create index reservations_held_expiry_idx on reservations (expires_at) where status = 'held';

-- Application role: the default grant of decision 0007, never DELETE.
grant select, insert, update on
  governorate_delivery, settings, customers, orders, order_lines, payments, reservations
  to dose_app;
grant usage on sequence order_number_seq to dose_app;
