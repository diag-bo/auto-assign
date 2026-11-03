-- Bots are rows now, so a new bot is added from the dashboard: paste its token and
-- the app registers /api/zalo/bot/<id> as its webhook (webhook_secret checks Zalo's
-- x-bot-api-secret-token header). token is NULL for the two original bots: they keep
-- their env tokens and their own webhook routes (Điều Phối X also answers revenue).
-- Server-only: RLS on, no policies; the API never returns token or secret.
create table if not exists public.client_bots (
  id text primary key,
  name text not null check (name <> ''),
  token text,
  webhook_secret text,
  created_at timestamptz not null default now()
);
alter table public.client_bots enable row level security;
insert into public.client_bots (id, name) values
  ('dieu_phoi', 'Bot Điều Phối X'),
  ('giao_nhan_mau', 'Bot Giao nhận mẫu')
on conflict (id) do nothing;

alter table public.client_bot_groups drop constraint if exists client_bot_groups_bot_check;
alter table public.client_bot_groups drop constraint if exists client_bot_groups_bot_fkey;
alter table public.client_bot_groups
  add constraint client_bot_groups_bot_fkey foreign key (bot) references public.client_bots(id) on delete restrict;

-- request: tagging the bot with a keyword books a client → D001 pickup
-- guide:   the "how to use the bot" message, Mon–Sat at guide_time (VN)
alter table public.client_bot_groups
  add column if not exists request boolean not null default false,
  add column if not exists guide boolean not null default false,
  add column if not exists guide_time text not null default '07:30'
    check (guide_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- One keyword list shared by every group (supervisor, 2026-11-03). The first three are
-- named in the daily tip. "có mẫu" is the supervisor's call: a client answering the
-- pickup reminder ("có mẫu không?") with it books a trip, held for review by its note.
create table if not exists public.client_bot_settings (
  id int primary key default 1 check (id = 1),
  request_keywords text[] not null default array['qua lấy mẫu', 'lấy mẫu', 'có mẫu', 'đặt chuyến', 'gọi tài xế']
);
alter table public.client_bot_settings enable row level security;
insert into public.client_bot_settings (id) values (1) on conflict (id) do nothing;

-- An Sinh's bot (Bot Trợ Lý Diag) shipped in code the same morning (dd74c569); it joins
-- as a third env-token bot, its group doing what that code did: reminder + cancel.
insert into public.client_bots (id, name) values ('an_sinh', 'Bot Trợ Lý Diag') on conflict (id) do nothing;
insert into public.client_bot_groups (bot, chat_id, customer_id, label, remind, cancel) values
  ('an_sinh', 'zgr-f12287b103e4eabab3f5', 'f0773008-0f51-11ee-951b-506b8dbc8dfb', 'An Sinh', true, true)
on conflict (bot, chat_id) do nothing;
