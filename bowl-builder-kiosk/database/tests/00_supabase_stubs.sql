-- LOCAL TESTING ONLY. Stands in for the parts of Supabase that plain Postgres
-- doesn't have, so schema.sql and supabase.sql can be tested anywhere.
-- Never run this on a Supabase project.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigserial primary key, topic text not null, event text, payload jsonb, private boolean, inserted_at timestamptz default now()
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$
  select current_setting('realtime.topic', true)
$$;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
language sql as $$
  insert into realtime.messages (topic, event, payload, private) values (topic, event, payload, private)
$$;
grant usage on schema realtime to authenticated;
grant select on realtime.messages to authenticated;

create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean);
