-- =============================================================================
-- Bowl Lab: database schema
-- PostgreSQL 15+ (Supabase-compatible). Portable: no Supabase-only features in
-- this file. Supabase wiring (Realtime channel policies, cron jobs, storage)
-- lives in supabase.sql.
--
-- Conventions
--   * Every table has RLS enabled. Clients never write orders directly.
--   * IDs are UUIDv7 (time-ordered, index friendly), generated in the database.
--   * Money is integer minor units (cents) + ISO 4217 currency on the location.
--   * Localized text is jsonb: {"en": "...", "es": "..."}.
--   * Small closed sets use CHECK constraints; open sets (nutrients, allergens,
--     diet tags) are reference tables so new ones need no migration.
--   * Published menus are immutable JSON snapshots. Orders snapshot every line.
--   * Helper functions live in schema "private" (not exposed by the API).
-- =============================================================================

create schema if not exists private;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- RFC 9562 UUIDv7: 48-bit unix ms timestamp + random. (Postgres 18 has uuidv7().)
create or replace function private.uuid_v7() returns uuid
language plpgsql volatile parallel safe as $$
declare
  ms bigint := floor(extract(epoch from clock_timestamp()) * 1000);
  b bytea := uuid_send(gen_random_uuid());
begin
  for i in 0..5 loop
    b := set_byte(b, i, ((ms >> ((5 - i) * 8)) & 255)::int);
  end loop;
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);  -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);  -- RFC variant
  return encode(b, 'hex')::uuid;
end $$;

-- JWT claims as set by PostgREST / Supabase for the current request.
create or replace function private.claims() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function private.uid() returns uuid
language sql stable as $$
  select nullif(private.claims() ->> 'sub', '')::uuid
$$;

create or replace function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Localized text must be an object with at least one string value.
create or replace function private.is_i18n(v jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(v) = 'object' and v <> '{}'::jsonb
     and not exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'string')
$$;

-- -----------------------------------------------------------------------------
-- Tenancy: organization > brand > location
-- -----------------------------------------------------------------------------

create table public.organizations (
  id          uuid primary key default private.uuid_v7(),
  name        text not null check (length(name) between 1 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.brands (
  id              uuid primary key default private.uuid_v7(),
  org_id          uuid not null references public.organizations on delete cascade,
  name            text not null,
  slug            text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  default_locale  text not null default 'en',
  locales         text[] not null default '{en}',
  theme           jsonb not null default '{}',        -- design token overrides
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, slug),
  check (default_locale = any (locales))
);
create index on public.brands (org_id);

create table public.locations (
  id               uuid primary key default private.uuid_v7(),
  org_id           uuid not null references public.organizations on delete cascade,
  brand_id         uuid not null references public.brands on delete restrict,
  name             text not null,
  timezone         text not null default 'UTC',
  currency         char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  tax_mode         text not null default 'exclusive' check (tax_mode in ('exclusive', 'inclusive')),
  tax_rate_bps     integer not null default 0 check (tax_rate_bps between 0 and 5000),  -- 800 = 8.00%
  allergen_regime  text not null default 'US9',
  order_prefix     text not null default 'A' check (order_prefix ~ '^[A-Z]{1,2}$'),
  day_starts_at    time not null default '04:00',     -- business day boundary for order numbers
  settings         jsonb not null default '{}',       -- idle timeout, KDS thresholds, warning icons, tipping...
  ordering_paused  boolean not null default false,    -- "pause kiosk ordering" switch
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.locations (org_id);
create index on public.locations (brand_id);

-- Managers may change operational settings; money and region settings are owner-only.
create or replace function private.guard_location_update() returns trigger
language plpgsql as $$
begin
  if private.uid() is not null
     and (new.currency, new.tax_mode, new.tax_rate_bps, new.timezone, new.allergen_regime, new.org_id, new.brand_id)
         is distinct from (old.currency, old.tax_mode, old.tax_rate_bps, old.timezone, old.allergen_regime, old.org_id, old.brand_id)
     and not private.has_org_role(old.org_id, '{owner}') then
    raise exception 'only owners can change currency, tax, timezone or allergen settings' using errcode = '42501';
  end if;
  return new;
end $$;

-- Staff access. location_id null = every location in the org.
create table public.memberships (
  id           uuid primary key default private.uuid_v7(),
  user_id      uuid not null,                         -- auth.users.id on Supabase
  org_id       uuid not null references public.organizations on delete cascade,
  location_id  uuid references public.locations on delete cascade,
  role         text not null check (role in ('owner', 'manager', 'staff', 'kitchen')),
  created_at   timestamptz not null default now(),
  unique nulls not distinct (user_id, org_id, location_id)
);
create index on public.memberships (user_id);
create index on public.memberships (org_id);
create index on public.memberships (location_id);

-- Kiosks, kitchen screens, pickup boards and print bridges. Each paired device
-- signs in as its own auth user (created by the pair-device Edge Function).
create table public.devices (
  id               uuid primary key default private.uuid_v7(),
  org_id           uuid not null references public.organizations on delete cascade,
  location_id      uuid not null references public.locations on delete cascade,
  kind             text not null check (kind in ('kiosk', 'kds', 'pickup', 'print_bridge')),
  name             text not null,
  short_code       text not null check (short_code ~ '^[A-Z0-9]{1,3}$'),  -- prefix for offline order numbers, e.g. K2
  auth_user_id     uuid unique,
  station          text check (station in ('line', 'grill', 'expo')),        -- KDS only
  app_version      text,
  menu_version_id  uuid,
  last_seen_at     timestamptz,
  status           jsonb not null default '{}',     -- battery, online, storage, last error
  paired_at        timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (location_id, short_code)
);
create index on public.devices (org_id);
create index on public.devices (location_id);

create table public.device_pairing_codes (
  code_hash    text primary key,                      -- sha256 of the 6-digit code
  location_id  uuid not null references public.locations on delete cascade,
  kind         text not null check (kind in ('kiosk', 'kds', 'pickup', 'print_bridge')),
  created_by   uuid not null,
  expires_at   timestamptz not null,
  used_at      timestamptz
);
create index on public.device_pairing_codes (location_id);

-- -----------------------------------------------------------------------------
-- Access helpers (security definer so RLS policies stay simple and fast)
-- -----------------------------------------------------------------------------

create or replace function private.current_device() returns public.devices
language sql stable security definer set search_path = '' as $$
  select d.* from public.devices d
  where d.auth_user_id = private.uid() and d.revoked_at is null
$$;

create or replace function private.has_org_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = private.uid() and m.org_id = p_org and m.role = any (p_roles)
  )
$$;

create or replace function private.has_location_role(p_location uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.locations l on l.org_id = m.org_id
    where m.user_id = private.uid() and l.id = p_location
      and (m.location_id is null or m.location_id = p_location)
      and m.role = any (p_roles)
  )
$$;

create or replace function private.device_at(p_location uuid, p_kinds text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.devices d
    where d.auth_user_id = private.uid() and d.revoked_at is null
      and d.location_id = p_location and d.kind = any (p_kinds)
  )
$$;

create or replace function private.device_in_brand(p_brand uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.devices d join public.locations l on l.id = d.location_id
    where d.auth_user_id = private.uid() and d.revoked_at is null and l.brand_id = p_brand
  )
$$;

-- Every location the caller may read, as staff (by role) or as a device (by kind).
-- Policies call it as "(select private.readable_locations(...))" so Postgres
-- evaluates it once per query instead of once per row.
create or replace function private.readable_locations(p_roles text[], p_device_kinds text[]) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select l.id as x from public.memberships m join public.locations l on l.org_id = m.org_id
     where m.user_id = private.uid() and m.role = any (p_roles) and (m.location_id is null or m.location_id = l.id)
    union
    select d.location_id from public.devices d
     where d.auth_user_id = private.uid() and d.revoked_at is null and d.kind = any (p_device_kinds)
  ) s
$$;

create or replace function private.brand_org(p_brand uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select org_id from public.brands where id = p_brand
$$;

-- -----------------------------------------------------------------------------
-- Reference data (open sets)
-- -----------------------------------------------------------------------------

create table public.nutrients (
  code           text primary key check (code ~ '^[a-z0-9_]+$'),   -- energy_kcal, protein_g ...
  name           jsonb not null check (private.is_i18n(name)),
  unit           text not null check (unit in ('kcal', 'g', 'mg', 'mcg')),
  daily_value    numeric(10, 3),
  display_order  smallint not null default 100
);

create table public.allergens (
  code     text primary key check (code ~ '^[a-z0-9_]+$'),
  name     jsonb not null check (private.is_i18n(name)),
  regimes  text[] not null                                          -- {'US9','EU14','CA'}
);

create table public.diet_tags (
  code  text primary key check (code ~ '^[a-z0-9_]+$'),
  name  jsonb not null check (private.is_i18n(name))
);

-- -----------------------------------------------------------------------------
-- Menu (draft, edited in Admin; per brand)
-- -----------------------------------------------------------------------------

create table public.schedules (               -- dayparts and limited-time offers
  id            uuid primary key default private.uuid_v7(),
  brand_id      uuid not null references public.brands on delete cascade,
  name          text not null,
  days_of_week  smallint[] not null default '{1,2,3,4,5,6,7}' check (days_of_week <@ '{1,2,3,4,5,6,7}'),
  starts_local  time,
  ends_local    time,
  starts_on     date,
  ends_on       date,
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index on public.schedules (brand_id);

create table public.ingredients (
  id             uuid primary key default private.uuid_v7(),
  brand_id       uuid not null references public.brands on delete cascade,
  slug           text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  name           jsonb not null check (private.is_i18n(name)),
  description    jsonb check (description is null or private.is_i18n(description)),
  image_path     text,                         -- storage path; CDN transforms produce sizes
  color          text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  serving_grams  numeric(8, 2) not null check (serving_grams >= 0),  -- grams in a Regular portion
  badges         text[] not null default '{}',
  nutrition_source text not null default 'estimate' check (nutrition_source in ('lab', 'recipe_calc', 'supplier', 'estimate')),
  nutrition_verified_at timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (brand_id, slug)
);

create table public.ingredient_nutrients (       -- per ONE Regular portion
  ingredient_id  uuid not null references public.ingredients on delete cascade,
  nutrient_code  text not null references public.nutrients,
  amount         numeric(12, 4) not null check (amount >= 0),
  primary key (ingredient_id, nutrient_code)
);
create index on public.ingredient_nutrients (nutrient_code);

create table public.ingredient_allergens (
  ingredient_id  uuid not null references public.ingredients on delete cascade,
  allergen_code  text not null references public.allergens,
  kind           text not null default 'contains' check (kind in ('contains', 'may_contain')),
  primary key (ingredient_id, allergen_code)
);
create index on public.ingredient_allergens (allergen_code);

create table public.ingredient_diet_tags (
  ingredient_id  uuid not null references public.ingredients on delete cascade,
  tag_code       text not null references public.diet_tags,
  primary key (ingredient_id, tag_code)
);
create index on public.ingredient_diet_tags (tag_code);

-- Food cost is owner-only, so it lives in its own table.
create table public.ingredient_costs (
  ingredient_id        uuid primary key references public.ingredients on delete cascade,
  cost_per_regular_minor integer not null check (cost_per_regular_minor >= 0),
  updated_at           timestamptz not null default now()
);

-- A product is something you can order. "configurable" products (bowls, salads,
-- protein cups, smoothies) have option groups; "simple" products (drinks) don't.
create table public.products (
  id           uuid primary key default private.uuid_v7(),
  brand_id     uuid not null references public.brands on delete cascade,
  slug         text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  kind         text not null check (kind in ('configurable', 'simple')),
  name         jsonb not null check (private.is_i18n(name)),
  description  jsonb check (description is null or private.is_i18n(description)),
  image_path   text,
  price_minor  integer check (price_minor >= 0),          -- simple products only
  schedule_id  uuid references public.schedules on delete set null,
  sort_order   integer not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (brand_id, slug),
  check ((kind = 'simple') = (price_minor is not null))
);
create index on public.products (schedule_id);

-- Nutrition and allergens for simple products (drinks).
create table public.product_nutrients (
  product_id     uuid not null references public.products on delete cascade,
  nutrient_code  text not null references public.nutrients,
  amount         numeric(12, 4) not null check (amount >= 0),
  primary key (product_id, nutrient_code)
);
create index on public.product_nutrients (nutrient_code);

-- The builder steps of a configurable product.
create table public.option_groups (
  id                  uuid primary key default private.uuid_v7(),
  product_id          uuid not null references public.products on delete cascade,
  slug                text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name                jsonb not null check (private.is_i18n(name)),
  position            smallint not null,
  min_select          smallint not null default 0 check (min_select >= 0),
  max_select          smallint not null check (max_select >= 1),
  included_count      smallint not null default 0 check (included_count >= 0),
  extra_price_minor   integer not null default 0 check (extra_price_minor >= 0),
  sets_base_price     boolean not null default false,   -- e.g. protein sets the bowl price
  half_and_half       boolean not null default false,   -- two picks become two Half portions
  allow_on_side       boolean not null default false,
  unique (product_id, slug),
  unique (product_id, position),
  check (min_select <= max_select)
);

create table public.option_group_items (
  group_id            uuid not null references public.option_groups on delete cascade,
  ingredient_id       uuid not null references public.ingredients on delete restrict,
  position            smallint not null,
  allowed_portions    text[] not null default '{light,regular,extra}'
                      check (allowed_portions <@ '{light,half,regular,extra,double}' and 'regular' = any (allowed_portions)),
  price_minor         integer not null default 0 check (price_minor >= 0),       -- add-on price
  base_price_minor    integer check (base_price_minor >= 0),                     -- when the group sets the price
  portion_deltas_minor jsonb not null default '{}',                              -- {"double": 350}
  premium             boolean not null default false,
  schedule_id         uuid references public.schedules on delete set null,
  primary key (group_id, ingredient_id)
);
create index on public.option_group_items (ingredient_id);
create index on public.option_group_items (schedule_id);

create table public.signature_items (
  id           uuid primary key default private.uuid_v7(),
  product_id   uuid not null references public.products on delete cascade,
  slug         text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  name         jsonb not null check (private.is_i18n(name)),
  badges       text[] not null default '{}',
  lines        jsonb not null check (jsonb_typeof(lines) = 'array'),   -- [{ingredientId, portion, onSide}]
  position     smallint not null default 0,
  schedule_id  uuid references public.schedules on delete set null,
  unique (product_id, slug)
);
create index on public.signature_items (schedule_id);

-- Per-location price overrides (same menu, different city prices).
create table public.location_option_prices (
  location_id          uuid not null references public.locations on delete cascade,
  group_id             uuid not null,
  ingredient_id        uuid not null,
  price_minor          integer check (price_minor >= 0),
  base_price_minor     integer check (base_price_minor >= 0),
  portion_deltas_minor jsonb,
  primary key (location_id, group_id, ingredient_id),
  foreign key (group_id, ingredient_id) references public.option_group_items on delete cascade
);
create index on public.location_option_prices (group_id, ingredient_id);

create table public.location_product_prices (
  location_id  uuid not null references public.locations on delete cascade,
  product_id   uuid not null references public.products on delete cascade,
  price_minor  integer not null check (price_minor >= 0),
  primary key (location_id, product_id)
);
create index on public.location_product_prices (product_id);

create table public.promotions (
  id                  uuid primary key default private.uuid_v7(),
  brand_id            uuid not null references public.brands on delete cascade,
  code                text not null check (code ~ '^[A-Z0-9-]{3,20}$'),
  name                jsonb not null check (private.is_i18n(name)),
  kind                text not null check (kind in ('percent', 'amount')),
  value               integer not null check (value > 0),     -- percent (1-100) or minor units
  min_subtotal_minor  integer not null default 0,
  starts_at           timestamptz,
  ends_at             timestamptz,
  max_redemptions     integer,
  redemptions         integer not null default 0,
  location_ids        uuid[],                                  -- null = all locations
  is_active           boolean not null default true,
  unique (brand_id, code),
  check (kind <> 'percent' or value <= 100)
);

-- -----------------------------------------------------------------------------
-- Published menus (immutable) and what each location is serving
-- -----------------------------------------------------------------------------

create table public.menu_versions (
  id              uuid primary key default private.uuid_v7(),
  brand_id        uuid not null references public.brands on delete cascade,
  version         integer not null,
  schema_version  smallint not null default 1,       -- shape of payload, for old kiosks
  payload         jsonb not null,                    -- compiled menu the kiosk loads
  payload_sha256  text not null,
  notes           text,
  published_by    uuid,
  published_at    timestamptz not null default now(),
  unique (brand_id, version)
);

create table public.location_menus (
  location_id      uuid primary key references public.locations on delete cascade,
  menu_version_id  uuid not null references public.menu_versions,
  effective_at     timestamptz not null default now()
);
create index on public.location_menus (menu_version_id);

-- Sold-out state and optional "86 counts" per location.
create table public.availability (
  location_id      uuid not null references public.locations on delete cascade,
  ingredient_id    uuid not null references public.ingredients on delete cascade,
  is_available     boolean not null default true,
  remaining_count  integer check (remaining_count >= 0),   -- null = not counted
  low_threshold    integer check (low_threshold >= 0),
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  primary key (location_id, ingredient_id)
);
create index on public.availability (ingredient_id);

-- -----------------------------------------------------------------------------
-- Orders
-- -----------------------------------------------------------------------------

create table public.order_counters (
  location_id    uuid not null references public.locations on delete cascade,
  business_date  date not null,
  last_number    integer not null,
  primary key (location_id, business_date)
);

create table public.orders (
  id                  uuid primary key default private.uuid_v7(),
  org_id              uuid not null references public.organizations,
  location_id         uuid not null references public.locations,
  device_id           uuid references public.devices on delete set null,
  channel             text not null check (channel in ('kiosk', 'phone', 'staff', 'api')),
  idempotency_key     text not null check (length(idempotency_key) between 8 and 80),
  number              text not null,
  business_date       date not null,
  menu_version_id     uuid not null references public.menu_versions,
  dining_option       text not null check (dining_option in ('dine_in', 'take_out')),
  locale              text not null default 'en',
  customer_name       text check (length(customer_name) <= 20),
  allergy_note        text check (length(allergy_note) <= 200),
  status              text not null default 'new' check (status in ('new', 'in_progress', 'ready', 'picked_up', 'cancelled')),
  payment_status      text not null default 'pay_at_counter' check (payment_status in ('pay_at_counter', 'pending', 'paid', 'refunded', 'void')),
  currency            char(3) not null,
  tax_mode            text not null check (tax_mode in ('exclusive', 'inclusive')),
  tax_rate_bps        integer not null,
  subtotal_minor      integer not null check (subtotal_minor >= 0),
  discount_minor      integer not null default 0 check (discount_minor >= 0),
  tax_minor           integer not null check (tax_minor >= 0),
  total_minor         integer not null check (total_minor >= 0),
  created_offline     boolean not null default false,
  client_created_at   timestamptz,
  placed_at           timestamptz not null default now(),
  started_at          timestamptz,
  ready_at            timestamptz,
  picked_up_at        timestamptz,
  pii_purged_at       timestamptz,
  unique (device_id, idempotency_key),
  unique (location_id, business_date, number)
);
create index orders_kitchen_idx on public.orders (location_id, business_date, status);
create index on public.orders (location_id, placed_at desc);
create index on public.orders (org_id);
create index on public.orders (menu_version_id);
create index orders_pii_idx on public.orders (placed_at) where pii_purged_at is null;

create table public.order_items (
  id               uuid primary key default private.uuid_v7(),
  order_id         uuid not null references public.orders on delete cascade,
  position         smallint not null,
  product_id       uuid references public.products on delete set null,
  product_slug     text not null,
  name             text not null,                  -- snapshot in the order's locale
  label_name       text check (length(label_name) <= 20),   -- "Sam's bowl" for group orders
  quantity         smallint not null default 1 check (quantity between 1 and 20),
  unit_price_minor integer not null check (unit_price_minor >= 0),
  line_total_minor integer not null check (line_total_minor >= 0),
  nutrition        jsonb not null default '{}',     -- raw per-unit totals {energy_kcal: 530, ...}
  allergens        text[] not null default '{}',
  diet_tags        text[] not null default '{}',
  bowl_code        text,
  signature_slug   text,
  unique (order_id, position)
);
create index on public.order_items (product_id);

create table public.order_item_options (
  order_item_id    uuid not null references public.order_items on delete cascade,
  position         smallint not null,
  group_slug       text not null,
  ingredient_id    uuid references public.ingredients on delete set null,
  ingredient_slug  text not null,
  name             text not null,
  portion          text not null check (portion in ('light', 'half', 'regular', 'extra', 'double')),
  grams            numeric(8, 2) not null,
  on_side          boolean not null default false,
  price_minor      integer not null default 0,
  primary key (order_item_id, position)
);
create index on public.order_item_options (ingredient_id);

create table public.order_status_events (
  id           uuid primary key default private.uuid_v7(),
  order_id     uuid not null references public.orders on delete cascade,
  from_status  text,
  to_status    text not null,
  actor_user   uuid,
  actor_device uuid,
  at           timestamptz not null default now()
);
create index on public.order_status_events (order_id, at);

create table public.order_discounts (
  order_id      uuid not null references public.orders on delete cascade,
  promotion_id  uuid references public.promotions on delete set null,
  code          text not null,
  amount_minor  integer not null check (amount_minor >= 0),
  primary key (order_id, code)
);
create index on public.order_discounts (promotion_id);

create table public.payments (
  id            uuid primary key default private.uuid_v7(),
  order_id      uuid not null references public.orders on delete cascade,
  provider      text not null,                       -- 'counter', 'stripe_terminal', 'square_terminal'
  provider_ref  text,
  amount_minor  integer not null check (amount_minor >= 0),
  currency      char(3) not null,
  status        text not null check (status in ('pending', 'succeeded', 'failed', 'refunded', 'canceled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index on public.payments (order_id);

-- Reorder codes printed on receipts. No personal data.
create table public.bowl_codes (
  code          text primary key check (code ~ '^[ACDEFHJKMNPRTUVWXY34679]{6}$'),
  brand_id      uuid not null references public.brands on delete cascade,
  product_slug  text not null,
  lines         jsonb not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz not null default now() + interval '1 year'
);
create index on public.bowl_codes (brand_id);
create index on public.bowl_codes (expires_at);

-- -----------------------------------------------------------------------------
-- Operations: analytics events, audit log, integration outbox
-- -----------------------------------------------------------------------------

create table public.kiosk_events (
  id           uuid not null default private.uuid_v7(),
  occurred_at  timestamptz not null default now(),
  location_id  uuid not null,
  device_id    uuid,
  session_id   uuid not null,                       -- random per customer session, no PII
  name         text not null check (name ~ '^[a-z_.]{3,60}$'),
  props        jsonb not null default '{}',
  primary key (id, occurred_at)
) partition by range (occurred_at);
create table public.kiosk_events_default partition of public.kiosk_events default;
create index on public.kiosk_events (location_id, occurred_at);

create table public.audit_log (
  id            uuid primary key default private.uuid_v7(),
  org_id        uuid,
  actor_user    uuid,
  table_name    text not null,
  row_pk        jsonb not null,
  action        text not null check (action in ('insert', 'update', 'delete')),
  before        jsonb,
  after         jsonb,
  at            timestamptz not null default now()
);
create index on public.audit_log (org_id, at desc);

-- Transactional outbox: rows written in the same transaction as the change,
-- delivered by a worker (receipts, label printing, POS sync, webhooks).
-- On Supabase this can be swapped for pgmq (Supabase Queues).
create table public.integration_outbox (
  id            uuid primary key default private.uuid_v7(),
  topic         text not null,                      -- 'order.placed', 'order.status_changed', 'menu.published'
  location_id   uuid,
  payload       jsonb not null,
  status        text not null default 'pending' check (status in ('pending', 'processing', 'done', 'dead')),
  attempts      smallint not null default 0,
  available_at  timestamptz not null default now(),
  last_error    text,
  created_at    timestamptz not null default now()
);
create index outbox_ready_idx on public.integration_outbox (available_at) where status = 'pending';

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['organizations', 'brands', 'locations', 'devices', 'ingredients', 'products', 'payments'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Audit trigger for menu, pricing, availability and settings changes
-- -----------------------------------------------------------------------------

create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  v_org uuid;
begin
  v_org := coalesce(
    (rec ->> 'org_id')::uuid,
    case when rec ? 'brand_id' then private.brand_org((rec ->> 'brand_id')::uuid) end,
    case when rec ? 'location_id' then (select org_id from public.locations where id = (rec ->> 'location_id')::uuid) end,
    case when rec ? 'ingredient_id' then (select private.brand_org(brand_id) from public.ingredients where id = (rec ->> 'ingredient_id')::uuid) end,
    case when rec ? 'product_id' then (select private.brand_org(brand_id) from public.products where id = (rec ->> 'product_id')::uuid) end
  );
  insert into public.audit_log (org_id, actor_user, table_name, row_pk, action, before, after)
  values (v_org, private.uid(), tg_table_name,
          jsonb_strip_nulls(jsonb_build_object('id', rec -> 'id', 'location_id', rec -> 'location_id', 'ingredient_id', rec -> 'ingredient_id', 'group_id', rec -> 'group_id')),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['locations', 'ingredients', 'ingredient_nutrients', 'ingredient_allergens', 'ingredient_costs',
                           'products', 'option_groups', 'option_group_items', 'location_option_prices',
                           'location_product_prices', 'promotions', 'availability', 'memberships'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.audit()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Realtime fan-out. Sends small payloads to private per-location topics when
-- running on Supabase (realtime.send exists); a no-op elsewhere.
-- Clients refetch details through RLS-protected queries.
-- -----------------------------------------------------------------------------

create or replace function private.broadcast(p_topic text, p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'select realtime.send($1, $2, $3, true)' using p_payload, p_event, p_topic;
  end if;
end $$;

create or replace function private.on_order_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.broadcast('location:' || new.location_id || ':orders',
    case when tg_op = 'INSERT' then 'order.placed' else 'order.updated' end,
    jsonb_build_object('id', new.id, 'number', new.number, 'status', new.status));
  return new;
end $$;
create trigger guard_location_update before update on public.locations
  for each row execute function private.guard_location_update();

create trigger broadcast_order after insert or update of status on public.orders
  for each row execute function private.on_order_change();

create or replace function private.on_availability_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.broadcast('location:' || new.location_id || ':availability', 'availability.changed',
    jsonb_build_object('ingredient_id', new.ingredient_id, 'is_available', new.is_available, 'remaining_count', new.remaining_count));
  return new;
end $$;
create trigger broadcast_availability after insert or update on public.availability
  for each row execute function private.on_availability_change();

-- -----------------------------------------------------------------------------
-- RPC: place_order. Called ONLY by the place-order Edge Function (service
-- role) after it has validated the cart and recomputed every price and
-- nutrition value with the shared core. Atomic and idempotent.
-- -----------------------------------------------------------------------------

create or replace function public.place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_device   public.devices;
  v_loc      public.locations;
  v_existing public.orders;
  v_order    public.orders;
  v_date     date;
  v_n        integer;
  v_number   text;
  v_item     jsonb;
  v_opt      jsonb;
  v_item_id  uuid;
  i          integer := 0;
  j          integer;
begin
  select * into v_device from public.devices where id = (p ->> 'device_id')::uuid and revoked_at is null;
  if not found then raise exception 'unknown or revoked device' using errcode = '28000'; end if;
  if v_device.kind <> 'kiosk' and coalesce(p ->> 'channel', 'kiosk') = 'kiosk' then
    raise exception 'device % cannot place kiosk orders', v_device.id using errcode = '42501';
  end if;

  -- Idempotency: a retry returns the original order.
  select * into v_existing from public.orders
   where device_id = v_device.id and idempotency_key = p ->> 'idempotency_key';
  if found then
    return jsonb_build_object('id', v_existing.id, 'number', v_existing.number, 'duplicate', true);
  end if;

  select * into v_loc from public.locations where id = v_device.location_id;
  if v_loc.ordering_paused and not coalesce((p ->> 'created_offline')::boolean, false) then
    raise exception 'ordering is paused at this location' using errcode = 'P0001', hint = 'ordering_paused';
  end if;

  v_date := ((coalesce((p ->> 'client_created_at')::timestamptz, now()) at time zone v_loc.timezone) - v_loc.day_starts_at::interval)::date;

  if coalesce((p ->> 'created_offline')::boolean, false) and p ? 'offline_number' then
    v_number := p ->> 'offline_number';          -- e.g. K2-07, shown to the customer while offline
    if v_number !~ ('^' || v_device.short_code || '-[0-9]{2,4}$') then
      raise exception 'offline number % does not match device range %', v_number, v_device.short_code using errcode = '22023';
    end if;
  else
    insert into public.order_counters as c (location_id, business_date, last_number)
    values (v_loc.id, v_date, 1)
    on conflict (location_id, business_date) do update set last_number = c.last_number + 1
    returning last_number into v_n;
    v_number := v_loc.order_prefix || '-' || lpad(v_n::text, 3, '0');
  end if;

  insert into public.orders (
    org_id, location_id, device_id, channel, idempotency_key, number, business_date, menu_version_id,
    dining_option, locale, customer_name, allergy_note, payment_status, currency, tax_mode, tax_rate_bps,
    subtotal_minor, discount_minor, tax_minor, total_minor, created_offline, client_created_at)
  values (
    v_loc.org_id, v_loc.id, v_device.id, coalesce(p ->> 'channel', 'kiosk'), p ->> 'idempotency_key', v_number, v_date,
    (p ->> 'menu_version_id')::uuid, p ->> 'dining_option', coalesce(p ->> 'locale', 'en'),
    nullif(btrim(p ->> 'customer_name'), ''), nullif(btrim(p ->> 'allergy_note'), ''),
    coalesce(p ->> 'payment_status', 'pay_at_counter'), v_loc.currency, v_loc.tax_mode, v_loc.tax_rate_bps,
    (p ->> 'subtotal_minor')::integer, coalesce((p ->> 'discount_minor')::integer, 0),
    (p ->> 'tax_minor')::integer, (p ->> 'total_minor')::integer,
    coalesce((p ->> 'created_offline')::boolean, false), (p ->> 'client_created_at')::timestamptz)
  on conflict (device_id, idempotency_key) do nothing
  returning * into v_order;

  if v_order.id is null then   -- lost a race with a concurrent retry
    select * into v_existing from public.orders where device_id = v_device.id and idempotency_key = p ->> 'idempotency_key';
    return jsonb_build_object('id', v_existing.id, 'number', v_existing.number, 'duplicate', true);
  end if;

  if v_order.total_minor <> v_order.subtotal_minor - v_order.discount_minor
       + (case when v_order.tax_mode = 'exclusive' then v_order.tax_minor else 0 end) then
    raise exception 'order totals do not add up' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    i := i + 1;
    insert into public.order_items (order_id, position, product_id, product_slug, name, label_name, quantity,
      unit_price_minor, line_total_minor, nutrition, allergens, diet_tags, bowl_code, signature_slug)
    values (v_order.id, i, (v_item ->> 'product_id')::uuid, v_item ->> 'product_slug', v_item ->> 'name',
      nullif(btrim(v_item ->> 'label_name'), ''), coalesce((v_item ->> 'quantity')::smallint, 1),
      (v_item ->> 'unit_price_minor')::integer, (v_item ->> 'line_total_minor')::integer,
      coalesce(v_item -> 'nutrition', '{}'),
      coalesce(array(select jsonb_array_elements_text(v_item -> 'allergens')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_item -> 'diet_tags')), '{}'),
      v_item ->> 'bowl_code', v_item ->> 'signature_slug')
    returning id into v_item_id;

    j := 0;
    for v_opt in select * from jsonb_array_elements(coalesce(v_item -> 'options', '[]')) loop
      j := j + 1;
      insert into public.order_item_options (order_item_id, position, group_slug, ingredient_id, ingredient_slug,
        name, portion, grams, on_side, price_minor)
      values (v_item_id, j, v_opt ->> 'group_slug', (v_opt ->> 'ingredient_id')::uuid, v_opt ->> 'ingredient_slug',
        v_opt ->> 'name', v_opt ->> 'portion', (v_opt ->> 'grams')::numeric,
        coalesce((v_opt ->> 'on_side')::boolean, false), coalesce((v_opt ->> 'price_minor')::integer, 0));

      -- 86 counts: decrement, and mark sold out at zero.
      update public.availability a
         set remaining_count = greatest(a.remaining_count - coalesce((v_item ->> 'quantity')::integer, 1), 0),
             is_available = a.remaining_count - coalesce((v_item ->> 'quantity')::integer, 1) > 0,
             updated_at = now()
       where a.location_id = v_loc.id and a.ingredient_id = (v_opt ->> 'ingredient_id')::uuid
         and a.remaining_count is not null;
    end loop;
  end loop;

  if i = 0 then raise exception 'order has no items' using errcode = '22023'; end if;

  insert into public.order_status_events (order_id, from_status, to_status, actor_device)
  values (v_order.id, null, 'new', v_device.id);

  insert into public.integration_outbox (topic, location_id, payload)
  values ('order.placed', v_loc.id, jsonb_build_object('order_id', v_order.id, 'number', v_number));

  return jsonb_build_object('id', v_order.id, 'number', v_number, 'duplicate', false, 'business_date', v_date);
end $$;

revoke all on function public.place_order(jsonb) from public;

-- -----------------------------------------------------------------------------
-- RPC: set_order_status (kitchen staff and KDS devices)
-- -----------------------------------------------------------------------------

create or replace function public.set_order_status(p_order uuid, p_to text) returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  dev public.devices := private.current_device();
  ok boolean;
  v_from text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;

  if not (private.has_location_role(o.location_id, '{owner,manager,staff,kitchen}')
          or (dev.id is not null and dev.location_id = o.location_id and dev.kind = 'kds')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_from := o.status;
  ok := (o.status, p_to) in (
    ('new', 'in_progress'), ('new', 'ready'), ('new', 'cancelled'),
    ('in_progress', 'ready'), ('in_progress', 'new'), ('in_progress', 'cancelled'),
    ('ready', 'picked_up'), ('ready', 'in_progress'),
    ('picked_up', 'ready'));                                  -- "recall"
  if not ok then
    raise exception 'cannot move order from % to %', o.status, p_to using errcode = '22023';
  end if;

  update public.orders set
    status = p_to,
    started_at = case when p_to = 'in_progress' then coalesce(started_at, now()) else started_at end,
    ready_at = case when p_to = 'ready' then now() when p_to in ('new', 'in_progress') then null else ready_at end,
    picked_up_at = case when p_to = 'picked_up' then now() when p_to = 'ready' then null else picked_up_at end
  where id = p_order returning * into o;

  insert into public.order_status_events (order_id, from_status, to_status, actor_user, actor_device)
  values (o.id, v_from, p_to, case when dev.id is null then private.uid() end, dev.id);
  insert into public.integration_outbox (topic, location_id, payload)
  values ('order.status_changed', o.location_id, jsonb_build_object('order_id', o.id, 'status', p_to));
  return o;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: set_availability (any staff role, or a KDS device at the location)
-- -----------------------------------------------------------------------------

create or replace function public.set_availability(p_location uuid, p_ingredient uuid, p_available boolean, p_remaining integer default null)
returns public.availability
language plpgsql security definer set search_path = '' as $$
declare a public.availability;
begin
  if not (private.has_location_role(p_location, '{owner,manager,staff,kitchen}') or private.device_at(p_location, '{kds}')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.availability as x (location_id, ingredient_id, is_available, remaining_count, updated_by)
  values (p_location, p_ingredient, p_available and coalesce(p_remaining, 1) > 0, p_remaining, private.uid())
  on conflict (location_id, ingredient_id) do update
    set is_available = excluded.is_available, remaining_count = excluded.remaining_count,
        updated_by = excluded.updated_by, updated_at = now()
  returning * into a;
  return a;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: publish_menu (owners). Payload is compiled and validated by the
-- publish-menu Edge Function with the shared Zod schema first.
-- -----------------------------------------------------------------------------

create or replace function public.publish_menu(p_brand uuid, p_payload jsonb, p_notes text default null, p_schema_version smallint default 1)
returns public.menu_versions
language plpgsql security definer set search_path = '' as $$
declare v public.menu_versions;
begin
  if not private.has_org_role(private.brand_org(p_brand), '{owner}') then
    raise exception 'only owners can publish menus' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('publish_menu:' || p_brand, 0));
  insert into public.menu_versions (brand_id, version, schema_version, payload, payload_sha256, notes, published_by)
  values (p_brand,
          coalesce((select max(version) from public.menu_versions where brand_id = p_brand), 0) + 1,
          p_schema_version, p_payload, encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex'), p_notes, private.uid())
  returning * into v;
  insert into public.integration_outbox (topic, payload) values ('menu.published', jsonb_build_object('brand_id', p_brand, 'menu_version_id', v.id, 'version', v.version));
  return v;
end $$;

-- Point locations at a version (all of a brand's locations, or one for a staged rollout).
create or replace function public.set_location_menu(p_location uuid, p_menu_version uuid) returns public.location_menus
language plpgsql security definer set search_path = '' as $$
declare r public.location_menus;
begin
  if not private.has_location_role(p_location, '{owner}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.menu_versions mv join public.locations l on l.brand_id = mv.brand_id
                 where mv.id = p_menu_version and l.id = p_location) then
    raise exception 'menu version belongs to another brand' using errcode = '22023';
  end if;
  insert into public.location_menus (location_id, menu_version_id) values (p_location, p_menu_version)
  on conflict (location_id) do update set menu_version_id = excluded.menu_version_id, effective_at = now()
  returning * into r;
  perform private.broadcast('location:' || p_location || ':menu', 'menu.changed', jsonb_build_object('menu_version_id', p_menu_version));
  return r;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: device heartbeat and pickup board
-- -----------------------------------------------------------------------------

create or replace function public.device_heartbeat(p_app_version text, p_menu_version uuid, p_status jsonb default '{}')
returns void
language plpgsql security definer set search_path = '' as $$
declare dev public.devices := private.current_device();
begin
  if dev.id is null then raise exception 'not a device' using errcode = '42501'; end if;
  update public.devices set app_version = p_app_version, menu_version_id = p_menu_version,
         status = coalesce(p_status, '{}'), last_seen_at = now()
   where id = dev.id;
end $$;

-- Only what a public screen may show: number, first name + initial, status.
create or replace function public.pickup_board() returns table (number text, display_name text, status text, changed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.number,
         case when o.customer_name is null then null
              else split_part(o.customer_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(o.customer_name, ' ', 2), ''), 1) || '.', '') end,
         o.status,
         coalesce(o.picked_up_at, o.ready_at, o.started_at, o.placed_at)
  from public.orders o, public.locations l
  where l.id = coalesce((private.current_device()).location_id, '00000000-0000-0000-0000-000000000000')
    and o.location_id = l.id
    and ((private.current_device()).kind in ('pickup', 'kds'))
    and o.business_date = ((now() at time zone l.timezone) - l.day_starts_at::interval)::date
    and (o.status in ('new', 'in_progress', 'ready') or (o.status = 'picked_up' and o.picked_up_at > now() - interval '5 minutes'))
  order by o.placed_at
$$;

-- -----------------------------------------------------------------------------
-- Maintenance (scheduled with pg_cron on Supabase; see supabase.sql)
-- -----------------------------------------------------------------------------

create or replace function private.purge_pii(p_days integer default 30) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.orders set customer_name = null, allergy_note = null, pii_purged_at = now()
   where pii_purged_at is null and placed_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  update public.order_items set label_name = null
   where label_name is not null and order_id in (select id from public.orders where pii_purged_at is not null);
  return n;
end $$;

create or replace function private.ensure_event_partitions(p_months_ahead integer default 2) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m date := date_trunc('month', now())::date;
  name text;
begin
  for k in 0..p_months_ahead loop
    name := 'kiosk_events_' || to_char(m + make_interval(months => k), 'YYYY_MM');
    if to_regclass('public.' || name) is null then
      execute format('create table public.%I partition of public.kiosk_events for values from (%L) to (%L)',
        name, m + make_interval(months => k), m + make_interval(months => k + 1));
      execute format('alter table public.%I enable row level security', name);
    end if;
  end loop;
end $$;

create or replace function private.drop_old_event_partitions(p_keep_months integer default 13) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
           where i.inhparent = 'public.kiosk_events'::regclass and c.relname ~ '^kiosk_events_\d{4}_\d{2}$'
             and to_date(right(c.relname, 7), 'YYYY_MM') < date_trunc('month', now()) - make_interval(months => p_keep_months) loop
    execute format('drop table public.%I', r.relname);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Tenancy
create policy org_read on public.organizations for select to authenticated
  using (private.has_org_role(id, '{owner,manager,staff,kitchen}'));
create policy org_write on public.organizations for update to authenticated
  using (private.has_org_role(id, '{owner}'));

create policy brand_read on public.brands for select to authenticated
  using (private.has_org_role(org_id, '{owner,manager,staff,kitchen}') or private.device_in_brand(id));
create policy brand_write on public.brands for all to authenticated
  using (private.has_org_role(org_id, '{owner}')) with check (private.has_org_role(org_id, '{owner}'));

create policy location_read on public.locations for select to authenticated
  using (private.has_location_role(id, '{owner,manager,staff,kitchen}') or private.device_at(id, '{kiosk,kds,pickup,print_bridge}'));
create policy location_write on public.locations for update to authenticated
  using (private.has_location_role(id, '{owner,manager}')) with check (private.has_location_role(id, '{owner,manager}'));

create policy membership_read on public.memberships for select to authenticated
  using (user_id = (select private.uid()) or private.has_org_role(org_id, '{owner}'));
create policy membership_write on public.memberships for all to authenticated
  using (private.has_org_role(org_id, '{owner}')) with check (private.has_org_role(org_id, '{owner}'));

create policy device_read on public.devices for select to authenticated
  using (auth_user_id = (select private.uid()) or private.has_location_role(location_id, '{owner,manager}'));
create policy device_write on public.devices for update to authenticated
  using (private.has_location_role(location_id, '{owner,manager}')) with check (private.has_location_role(location_id, '{owner,manager}'));
-- device_pairing_codes: no policies = no client access (Edge Function only).

-- Reference data: readable by any signed-in user or device.
create policy ref_read on public.nutrients for select to authenticated using (true);
create policy ref_read on public.allergens for select to authenticated using (true);
create policy ref_read on public.diet_tags for select to authenticated using (true);

-- Draft menu: staff read, owners write. Devices read published menus only.
do $$
declare t text;
begin
  foreach t in array array['schedules', 'ingredients', 'products', 'promotions'] loop
    execute format($f$create policy menu_read on public.%I for select to authenticated
      using (private.has_org_role(private.brand_org(brand_id), '{owner,manager,staff,kitchen}'))$f$, t);
    execute format($f$create policy menu_write on public.%I for all to authenticated
      using (private.has_org_role(private.brand_org(brand_id), '{owner}'))
      with check (private.has_org_role(private.brand_org(brand_id), '{owner}'))$f$, t);
  end loop;
end $$;

create or replace function private.ingredient_org(p_ingredient uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select private.brand_org(brand_id) from public.ingredients where id = p_ingredient
$$;
create or replace function private.product_org(p_product uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select private.brand_org(brand_id) from public.products where id = p_product
$$;
create or replace function private.group_org(p_group uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select private.product_org(product_id) from public.option_groups where id = p_group
$$;

do $$
declare
  t text; expr text;
  spec text[][] := array[
    array['ingredient_nutrients', 'private.ingredient_org(ingredient_id)'],
    array['ingredient_allergens', 'private.ingredient_org(ingredient_id)'],
    array['ingredient_diet_tags', 'private.ingredient_org(ingredient_id)'],
    array['product_nutrients', 'private.product_org(product_id)'],
    array['option_groups', 'private.product_org(product_id)'],
    array['option_group_items', 'private.group_org(group_id)'],
    array['signature_items', 'private.product_org(product_id)']];
begin
  for k in 1..array_length(spec, 1) loop
    t := spec[k][1]; expr := spec[k][2];
    execute format('create policy menu_read on public.%I for select to authenticated using (private.has_org_role(%s, ''{owner,manager,staff,kitchen}''))', t, expr);
    execute format('create policy menu_write on public.%I for all to authenticated using (private.has_org_role(%s, ''{owner}'')) with check (private.has_org_role(%s, ''{owner}''))', t, expr, expr);
  end loop;
end $$;

create policy cost_owner on public.ingredient_costs for all to authenticated
  using (private.has_org_role(private.ingredient_org(ingredient_id), '{owner}'))
  with check (private.has_org_role(private.ingredient_org(ingredient_id), '{owner}'));

create policy price_read on public.location_option_prices for select to authenticated
  using (private.has_location_role(location_id, '{owner,manager,staff,kitchen}'));
create policy price_write on public.location_option_prices for all to authenticated
  using (private.has_location_role(location_id, '{owner}')) with check (private.has_location_role(location_id, '{owner}'));
create policy price_read on public.location_product_prices for select to authenticated
  using (private.has_location_role(location_id, '{owner,manager,staff,kitchen}'));
create policy price_write on public.location_product_prices for all to authenticated
  using (private.has_location_role(location_id, '{owner}')) with check (private.has_location_role(location_id, '{owner}'));

-- Published menus
create policy menu_version_read on public.menu_versions for select to authenticated
  using (private.has_org_role(private.brand_org(brand_id), '{owner,manager,staff,kitchen}') or private.device_in_brand(brand_id));
create policy location_menu_read on public.location_menus for select to authenticated
  using (private.has_location_role(location_id, '{owner,manager,staff,kitchen}') or private.device_at(location_id, '{kiosk,kds,pickup}'));

create policy availability_read on public.availability for select to authenticated
  using (location_id = any ((select private.readable_locations('{owner,manager,staff,kitchen}', '{kiosk,kds}'))::uuid[]));

-- Orders: staff of the location and KDS devices read. Kiosks never read orders.
-- Child tables defer to the orders policy through EXISTS (RLS applies inside).
create policy order_read on public.orders for select to authenticated
  using (location_id = any ((select private.readable_locations('{owner,manager,staff,kitchen}', '{kds}'))::uuid[]));
create policy order_item_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy order_option_read on public.order_item_options for select to authenticated
  using (exists (select 1 from public.order_items i where i.id = order_item_id));
create policy order_event_read on public.order_status_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id)
         and (select private.current_device()).id is null);

create or replace function private.order_location(p_order uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select location_id from public.orders where id = p_order
$$;
create policy order_discount_read on public.order_discounts for select to authenticated
  using (private.has_location_role(private.order_location(order_id), '{owner,manager}'));
create policy payment_read on public.payments for select to authenticated
  using (private.has_location_role(private.order_location(order_id), '{owner,manager}'));

create policy events_read on public.kiosk_events for select to authenticated
  using (private.has_location_role(location_id, '{owner,manager}'));
create policy audit_read on public.audit_log for select to authenticated
  using (private.has_org_role(org_id, '{owner}'));
-- order_counters, bowl_codes, integration_outbox, device_pairing_codes: server only.

-- -----------------------------------------------------------------------------
-- Grants (Supabase roles). anon gets nothing: every client signs in, including
-- devices. Writes to orders happen only through RPCs.
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from anon, authenticated;
    grant usage on schema public to authenticated;
    grant select on all tables in schema public to authenticated;
    grant insert, update, delete on public.organizations, public.brands, public.locations, public.memberships,
      public.devices, public.schedules, public.ingredients, public.ingredient_nutrients, public.ingredient_allergens,
      public.ingredient_diet_tags, public.ingredient_costs, public.products, public.product_nutrients,
      public.option_groups, public.option_group_items, public.signature_items, public.location_option_prices,
      public.location_product_prices, public.promotions to authenticated;
    revoke select on public.order_counters, public.bowl_codes, public.integration_outbox, public.device_pairing_codes from authenticated;
    revoke execute on all functions in schema public from public, anon;
    grant execute on function public.set_order_status(uuid, text), public.set_availability(uuid, uuid, boolean, integer),
      public.publish_menu(uuid, jsonb, text, smallint), public.set_location_menu(uuid, uuid),
      public.device_heartbeat(text, uuid, jsonb), public.pickup_board() to authenticated;
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant execute on function public.place_order(jsonb) to service_role;
    grant usage on schema private to authenticated, service_role;
    revoke execute on all functions in schema private from public, anon;
    grant execute on all functions in schema private to authenticated, service_role;
  end if;
end $$;
