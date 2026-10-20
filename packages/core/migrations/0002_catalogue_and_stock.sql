-- 0002: the catalogue (products, images, variants) and the stock ledger.
-- Rule 5: a stock operation applies once per source key. Rule 3: reserved never exceeds on hand,
-- and on hand / reserved always equal the sum of the movements (the application keeps the two in
-- step inside one transaction; the database refuses a counter that leaves its range).

create table products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  name_ar text not null,
  name_en text not null,
  story_ar text not null,
  story_en text not null,
  label_copy_ar text not null,
  label_copy_en text not null,
  created_at timestamptz not null default now()
);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  r2_key text not null,
  alt_ar text not null,
  alt_en text not null,
  position int not null default 0
);
create index product_images_product_idx on product_images (product_id, position);

create table variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  sku text not null unique,
  kind text not null check (kind in ('full', 'sample', 'tester')),
  size_ml int not null check (size_ml > 0),
  price_piastres int not null check (price_piastres > 0),
  status text not null default 'active' check (status in ('active', 'archived'))
);
create index variants_product_idx on variants (product_id);

create table stock_levels (
  variant_id uuid primary key references variants (id),
  on_hand int not null default 0,
  reserved int not null default 0,
  check (reserved >= 0 and reserved <= on_hand)
);

-- Every variant has exactly one stock row from the moment it exists, so the stock operations
-- are plain guarded updates and never have to create one.
create function create_stock_level() returns trigger language plpgsql as $$
begin
  insert into stock_levels (variant_id) values (new.id);
  return new;
end
$$;

create trigger variants_create_stock_level
  after insert on variants
  for each row execute function create_stock_level();

-- The ledger: one row per stock change, never edited or removed by the code. The deltas for each reason are fixed by the check.
create table stock_movements (
  id bigserial primary key,
  variant_id uuid not null references variants (id),
  reason text not null check (reason in ('received', 'reserved', 'released', 'sold', 'returned', 'adjusted')),
  on_hand_delta int not null,
  reserved_delta int not null,
  source_key text not null unique,
  actor_type text not null check (actor_type in ('customer', 'staff', 'system')),
  actor_id text not null,
  at timestamptz not null default now(),
  check (
    case reason
      when 'received' then on_hand_delta > 0 and reserved_delta = 0
      when 'reserved' then on_hand_delta = 0 and reserved_delta > 0
      when 'released' then on_hand_delta = 0 and reserved_delta < 0
      when 'sold' then on_hand_delta < 0 and reserved_delta = on_hand_delta
      when 'returned' then on_hand_delta > 0 and reserved_delta = 0
      when 'adjusted' then on_hand_delta <> 0 and reserved_delta = 0
    end
  )
);
create index stock_movements_variant_idx on stock_movements (variant_id);

-- Application role: the default grant of decision 0003 on every table above, never DELETE. The
-- movement ledger is append-only (rule 5), so the app role may only read and add to it.
grant select, insert, update on products, product_images, variants, stock_levels to dose_app;
grant select, insert on stock_movements to dose_app;
grant usage on sequence stock_movements_id_seq to dose_app;
