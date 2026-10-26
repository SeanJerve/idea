-- =============================================================================
-- Supabase wiring. Run after schema.sql on a Supabase project.
-- (The local test harness stubs the realtime and cron schemas.)
-- =============================================================================

-- Realtime: private per-location topics, e.g. "location:<uuid>:orders".
-- Staff of the location and that location's devices may subscribe.
create or replace function private.topic_location(p_topic text) returns uuid
language sql immutable as $$
  select case when p_topic ~ '^location:[0-9a-f-]{36}:[a-z]+$' then split_part(p_topic, ':', 2)::uuid end
$$;

create policy "location topics: read" on realtime.messages for select to authenticated
  using (
    private.topic_location(realtime.topic()) is not null
    and (
      private.has_location_role(private.topic_location(realtime.topic()), '{owner,manager,staff,kitchen}')
      or (split_part(realtime.topic(), ':', 3) in ('availability', 'menu')
          and private.device_at(private.topic_location(realtime.topic()), '{kiosk,kds,pickup}'))
      or (split_part(realtime.topic(), ':', 3) = 'orders'
          and private.device_at(private.topic_location(realtime.topic()), '{kds,pickup,print_bridge}'))
    )
  );

-- Scheduled jobs (pg_cron). Minutes are off the hour on purpose.
select cron.schedule('purge-pii-nightly', '17 4 * * *', $$select private.purge_pii(30)$$);
select cron.schedule('event-partitions', '23 3 * * *', $$select private.ensure_event_partitions(2)$$);
select cron.schedule('drop-old-event-partitions', '41 3 1 * *', $$select private.drop_old_event_partitions(13)$$);
select cron.schedule('expire-bowl-codes', '53 4 * * 0', $$delete from public.bowl_codes where expires_at < now()$$);
select cron.schedule('expire-pairing-codes', '*/15 * * * *', $$delete from public.device_pairing_codes where expires_at < now() - interval '1 day'$$);

select private.ensure_event_partitions(2);

-- Storage: public, cache-friendly menu images; published menu JSON is served
-- by the menu Edge Function with ETag = payload_sha256.
insert into storage.buckets (id, name, public) values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;
