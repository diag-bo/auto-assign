-- Opening hours of a client location, entered by sales on /sales.
-- Neither Labcenter nor Cartrack has a field for them, so they live here, keyed
-- by the Labcenter location id. Information only: nothing in the engine reads it.
-- hours = { "1".."7": { closed?: true, open?, close?, break_from?, break_to? } }
-- (1 = Thứ 2 … 7 = Chủ nhật, times "HH:MM"); a missing day = not given.
create table if not exists public.location_hours (
  lc_location_id bigint primary key,
  client_code    text not null,
  hours          jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now(),
  updated_by     text
);
alter table public.location_hours enable row level security;
