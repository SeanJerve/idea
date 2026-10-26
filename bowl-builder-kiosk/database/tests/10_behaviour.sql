-- Behaviour and security tests. Runs after schema.sql, supabase.sql and seed.sql.
-- Each check raises an exception on failure (psql runs with ON_ERROR_STOP).
\set ON_ERROR_STOP on
\pset footer off

create schema t;
grant usage on schema t to authenticated, service_role;

create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

-- Sign in as a user or device for the rest of the transaction.
create function t.as_user(p_sub uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true)
$$;

-- Call a statement and report whether it raised an error.
create function t.raises(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;
grant execute on all functions in schema t to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures: a second org, staff users and paired devices
-- ---------------------------------------------------------------------------
create table t.ids (k text primary key, v uuid);
grant select on t.ids to authenticated, service_role;
create function t.id(p text) returns uuid language sql stable as $$ select v from t.ids where k = p $$;

insert into t.ids values
  ('owner', gen_random_uuid()), ('kitchen', gen_random_uuid()), ('manager', gen_random_uuid()),
  ('other_owner', gen_random_uuid()), ('kiosk_user', gen_random_uuid()), ('kds_user', gen_random_uuid()),
  ('pickup_user', gen_random_uuid());
insert into t.ids select 'org', id from public.organizations where slug = 'bowl-lab';
insert into t.ids select 'brand', id from public.brands where slug = 'bowl-lab';
insert into t.ids select 'loc', id from public.locations limit 1;

insert into public.organizations (name, slug) values ('Other Co', 'other-co');
insert into t.ids select 'org2', id from public.organizations where slug = 'other-co';
insert into public.brands (org_id, name, slug) values (t.id('org2'), 'Other', 'other');
insert into public.locations (org_id, brand_id, name) select t.id('org2'), id, 'Other Store' from public.brands where slug = 'other';
insert into t.ids select 'loc2', id from public.locations where name = 'Other Store';

insert into public.memberships (user_id, org_id, location_id, role) values
  (t.id('owner'), t.id('org'), null, 'owner'),
  (t.id('kitchen'), t.id('org'), t.id('loc'), 'kitchen'),
  (t.id('manager'), t.id('org'), t.id('loc'), 'manager'),
  (t.id('other_owner'), t.id('org2'), null, 'owner');

insert into public.devices (org_id, location_id, kind, name, short_code, auth_user_id, paired_at) values
  (t.id('org'), t.id('loc'), 'kiosk', 'Kiosk 1', 'K1', t.id('kiosk_user'), now()),
  (t.id('org'), t.id('loc'), 'kds', 'Line KDS', 'D1', t.id('kds_user'), now()),
  (t.id('org'), t.id('loc'), 'pickup', 'Pickup TV', 'P1', t.id('pickup_user'), now());
insert into t.ids select 'kiosk', id from public.devices where short_code = 'K1';
insert into t.ids select 'kds', id from public.devices where short_code = 'D1';
insert into t.ids select 'mv1', id from public.menu_versions where version = 1;
insert into t.ids select 'salmon', id from public.ingredients where slug = 'roasted-salmon';

-- Builds a place_order payload: Bowl A (or a salmon bowl), as the Edge Function would.
create function t.payload(p_key text, p_name text default null, p_salmon boolean default false, p_extra jsonb default '{}')
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'device_id', t.id('kiosk'), 'idempotency_key', p_key, 'menu_version_id', t.id('mv1'),
    'dining_option', 'dine_in', 'customer_name', p_name, 'allergy_note', 'No sesame please',
    'subtotal_minor', 1195, 'tax_minor', 96, 'total_minor', 1291,
    'items', jsonb_build_array(jsonb_build_object(
      'product_slug', 'custom-bowl', 'name', 'Build your own bowl', 'quantity', 1,
      'unit_price_minor', 1195, 'line_total_minor', 1195,
      'nutrition', '{"energy_kcal": 530, "protein_g": 50.5}'::jsonb, 'allergens', '["milk"]'::jsonb,
      'options', jsonb_build_array(
        jsonb_build_object('group_slug', 'base', 'ingredient_slug', 'quinoa', 'name', 'Quinoa', 'portion', 'regular', 'grams', 150,
                           'ingredient_id', (select id from public.ingredients where slug = 'quinoa')),
        jsonb_build_object('group_slug', 'protein', 'ingredient_slug', case when p_salmon then 'roasted-salmon' else 'grilled-chicken' end,
                           'name', 'Protein', 'portion', 'regular', 'grams', 113,
                           'ingredient_id', (select id from public.ingredients where slug = case when p_salmon then 'roasted-salmon' else 'grilled-chicken' end))))))
    || p_extra
$$;

-- ---------------------------------------------------------------------------
-- 1. Seed integrity
-- ---------------------------------------------------------------------------
select t.ok((select count(*) from public.ingredients) = 28, 'seed has 28 ingredients');
select t.ok((select count(*) from public.products) = 6, 'seed has 6 products (bowl, protein cup, 4 drinks)');
select t.ok((select count(*) from public.ingredients i where not exists (
  select 1 from public.ingredient_nutrients n where n.ingredient_id = i.id and n.nutrient_code = 'energy_kcal')) = 0, 'every ingredient has calories');
select t.ok((select sum(n.amount) from public.ingredient_nutrients n join public.ingredients i on i.id = n.ingredient_id
  where n.nutrient_code = 'energy_kcal' and i.slug in ('quinoa','grilled-chicken','roasted-broccoli','cucumber','feta','yogurt-herb')) = 530,
  'Bowl A ingredients add up to 530 kcal in the database');
select t.ok((select get_byte(uuid_send(private.uuid_v7()), 6) >> 4) = 7, 'uuid_v7 sets version 7');
do $$ declare a uuid := private.uuid_v7(); b uuid; begin
  perform pg_sleep(0.003); b := private.uuid_v7(); perform t.ok(a < b, 'uuid_v7 values from different milliseconds sort by time');
end $$;

-- ---------------------------------------------------------------------------
-- 2. place_order: numbering, idempotency, validation (as the Edge Function)
-- ---------------------------------------------------------------------------
set role service_role;
select t.ok((select public.place_order(t.payload('key-0001-aaaa', 'Sam Rivera')) ->> 'number') = 'A-001', 'first order is A-001');
select t.ok((select (public.place_order(t.payload('key-0001-aaaa', 'Sam Rivera')) ->> 'duplicate')::boolean), 'retry with the same key is a duplicate');
select t.ok((select count(*) from public.orders) = 1, 'retry did not create a second order');
select t.ok((select public.place_order(t.payload('key-0002-bbbb')) ->> 'number') = 'A-002', 'next order is A-002');
select t.ok(t.raises($$select public.place_order(t.payload('key-0003-cccc', null, false, '{"total_minor": 999}'))$$), 'totals that do not add up are rejected');
select t.ok(t.raises($$select public.place_order(t.payload('key-0004-dddd', null, false, '{"items": []}'))$$), 'an order with no items is rejected');
select t.ok((select public.place_order(t.payload('key-0005-eeee', null, false, '{"created_offline": true, "offline_number": "K1-07"}')) ->> 'number') = 'K1-07',
  'offline order keeps the number shown to the customer');
select t.ok(t.raises($$select public.place_order(t.payload('key-0006-ffff', null, false, '{"created_offline": true, "offline_number": "K9-01"}'))$$),
  'offline number outside the device range is rejected');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select t.as_user(t.id('kiosk_user'));
select t.ok((select count(*) from public.orders) = 0, 'kiosk cannot read orders');
select t.ok((select count(*) from public.menu_versions) = 1, 'kiosk can read its published menu');
select t.ok((select count(*) from public.ingredients) = 0, 'kiosk cannot read the draft menu');
select t.ok((select count(*) from public.availability) = 28, 'kiosk can read availability at its location');
select t.ok(t.raises($$select public.place_order(t.payload('key-0007-gggg'))$$), 'kiosk cannot call place_order directly');
select t.ok(t.raises($$insert into public.orders (org_id) values (t.id('org'))$$), 'kiosk cannot insert orders');
select t.ok(t.raises($$select public.set_order_status((select id from public.orders limit 1), 'ready')$$), 'kiosk cannot change order status');

select t.as_user(t.id('kds_user'));
select t.ok((select count(*) from public.orders) = 3, 'KDS reads its location''s orders');
select t.ok((select count(*) from public.order_item_options) = 6, 'KDS reads order lines');
select t.ok((select count(*) from public.ingredient_costs) = 0 and (select count(*) from public.audit_log) = 0, 'KDS cannot read costs or audit log');

select t.as_user(t.id('kitchen'));
select t.ok((select count(*) from public.orders) = 3, 'kitchen staff read orders');
select t.ok((select count(*) from public.ingredients) = 28, 'kitchen staff read the draft menu');
select t.ok(t.raises($$update public.ingredients set color = '#000000' where slug = 'quinoa'$$)
            or (select color from public.ingredients where slug = 'quinoa') <> '#000000', 'kitchen staff cannot edit the menu');

select t.as_user(t.id('other_owner'));
select t.ok((select count(*) from public.orders) = 0, 'another organization sees no orders');
select t.ok((select count(*) from public.ingredients) = 0, 'another organization sees no menu');
select t.ok((select count(*) from public.menu_versions) = 0, 'another organization sees no published menu');
commit;

-- ---------------------------------------------------------------------------
-- 4. Order status workflow
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select t.as_user(t.id('kds_user'));
select t.ok((select status from public.set_order_status((select id from public.orders where number = 'A-001'), 'in_progress')) = 'in_progress', 'KDS starts an order');
select t.ok(t.raises($$select public.set_order_status((select id from public.orders where number = 'A-001'), 'picked_up')$$), 'cannot skip from in_progress to picked_up');
select t.ok((select status from public.set_order_status((select id from public.orders where number = 'A-001'), 'ready')) = 'ready', 'KDS marks it ready');
select t.as_user(t.id('other_owner'));
select t.ok(t.raises($$select public.set_order_status((select id from public.orders limit 1), 'picked_up')$$), 'other org cannot change status');
commit;
select t.ok((select count(*) from public.order_status_events e join public.orders o on o.id = e.order_id where o.number = 'A-001') = 3,
  'status history records every change');
select t.ok((select from_status from public.order_status_events e join public.orders o on o.id = e.order_id
  where o.number = 'A-001' and e.to_status = 'ready') = 'in_progress', 'status history records the previous status');

-- ---------------------------------------------------------------------------
-- 5. Pickup board shows only safe fields
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select t.as_user(t.id('pickup_user'));
select t.ok((select display_name from public.pickup_board() where number = 'A-001') = 'Sam R.', 'pickup board shortens names to "Sam R."');
select t.ok((select count(*) from public.pickup_board()) = 3, 'pickup board lists today''s orders');
select t.ok((select count(*) from public.orders) = 0, 'pickup screen cannot read orders (no allergy notes)');
select t.as_user(t.id('kiosk_user'));
select t.ok((select count(*) from public.pickup_board()) = 0, 'a kiosk gets an empty pickup board');
commit;

-- ---------------------------------------------------------------------------
-- 6. 86 counts: the last salmon sells out automatically
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select t.as_user(t.id('kitchen'));
select t.ok((select remaining_count from public.set_availability(t.id('loc'), t.id('salmon'), true, 1)) = 1, 'kitchen sets salmon count to 1');
commit;
set role service_role;
select public.place_order(t.payload('key-0008-hhhh', null, true));
reset role;
select t.ok((select not is_available and remaining_count = 0 from public.availability where ingredient_id = t.id('salmon')), 'salmon sells out at zero');

-- ---------------------------------------------------------------------------
-- 7. Realtime fan-out and outbox
-- ---------------------------------------------------------------------------
select t.ok((select count(*) from realtime.messages where topic = 'location:' || t.id('loc') || ':orders' and event = 'order.placed') = 4,
  'each order is broadcast on the location topic');
select t.ok((select count(*) from realtime.messages where topic like '%:availability') >= 1, 'availability changes are broadcast');
select t.ok((select count(*) from public.integration_outbox where topic = 'order.placed') = 4, 'each order writes an outbox row');
begin;
set local role authenticated;
select t.as_user(t.id('kiosk_user'));
select set_config('realtime.topic', 'location:' || t.id('loc') || ':orders', true);
select t.ok((select count(*) from realtime.messages) = 0, 'kiosk cannot subscribe to the orders topic');
select set_config('realtime.topic', 'location:' || t.id('loc') || ':availability', true);
select t.ok((select count(*) from realtime.messages) >= 1, 'kiosk can subscribe to the availability topic');
select t.as_user(t.id('kds_user'));
select set_config('realtime.topic', 'location:' || t.id('loc') || ':orders', true);
select t.ok((select count(*) from realtime.messages) > 0, 'KDS can subscribe to the orders topic');
select t.as_user(t.id('other_owner'));
select t.ok((select count(*) from realtime.messages) = 0, 'another org cannot subscribe');
commit;

-- ---------------------------------------------------------------------------
-- 8. Publishing, settings guard, pause switch, audit
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select t.as_user(t.id('kitchen'));
select t.ok(t.raises($$select public.publish_menu(t.id('brand'), '{"x": 1}')$$), 'kitchen staff cannot publish menus');
select t.as_user(t.id('owner'));
select t.ok((select version from public.publish_menu(t.id('brand'), '{"x": 1}', 'Spring menu')) = 2, 'owner publishes version 2');
update public.ingredients set color = '#123456' where slug = 'feta';
select t.as_user(t.id('manager'));
select t.ok(t.raises($$update public.locations set tax_rate_bps = 0 where id = t.id('loc')$$), 'managers cannot change the tax rate');
update public.locations set ordering_paused = true where id = t.id('loc');
commit;
select t.ok((select actor_user from public.audit_log where table_name = 'ingredients' and action = 'update' order by at desc limit 1) = t.id('owner'),
  'menu edits are audited with the actor');
select t.ok((select org_id from public.audit_log where table_name = 'ingredients' and action = 'update' order by at desc limit 1) = t.id('org'),
  'audit rows carry the organization');
set role service_role;
select t.ok(t.raises($$select public.place_order(t.payload('key-0009-iiii'))$$), 'ordering_paused blocks new kiosk orders');
reset role;
update public.locations set ordering_paused = false where id = t.id('loc');

-- ---------------------------------------------------------------------------
-- 9. Privacy and partitions
-- ---------------------------------------------------------------------------
update public.orders set placed_at = now() - interval '31 days' where number = 'A-001';
select t.ok(private.purge_pii(30) = 1, 'purge_pii clears one old order');
select t.ok((select customer_name is null and allergy_note is null from public.orders where number = 'A-001'), 'name and allergy note are gone');
select t.ok((select count(*) from pg_class c join pg_inherits i on i.inhrelid = c.oid
  where i.inhparent = 'public.kiosk_events'::regclass and c.relname ~ '^kiosk_events_\d{4}_\d{2}$' and c.relrowsecurity) >= 3,
  'monthly event partitions exist with RLS on');
select t.ok((select count(*) from cron.job) = 5, 'five scheduled jobs are registered');
select t.ok((select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) = 0, 'every public table has RLS enabled');

\echo 'ALL TESTS PASSED'
