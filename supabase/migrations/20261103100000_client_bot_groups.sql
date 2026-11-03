-- Client Zalo groups: which of our bots sits in which client's group, and what it
-- does there. Edited from Master Setup → "Bot khách hàng"; replaces the group map
-- that was hard-coded in scheduled-pickup-reminder.ts.
--   remind: post the fixed-pickup reminder when the client's Lịch cố định job releases
--   cancel: a "không có mẫu" reply cancels that day's fixed pickup
-- A row with both off still claims the group, so the bot stays silent there instead
-- of answering with the revenue bot's "no permission" reply.
create table if not exists public.client_bot_groups (
  bot text not null check (bot in ('dieu_phoi', 'giao_nhan_mau')),
  chat_id text not null check (chat_id <> ''),
  customer_id text not null check (customer_id <> ''),
  label text not null default '',
  remind boolean not null default true,
  cancel boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (bot, chat_id)
);
alter table public.client_bot_groups enable row level security;

insert into public.client_bot_groups (bot, chat_id, customer_id, label) values
  ('dieu_phoi', 'zgr-1c7aa981bbcf52910bde', '51bfb168-446f-11ed-888f-506b8dbc8dfb', 'Phòng khám 2 Viện Tim'),
  ('dieu_phoi', 'zgr-5f2b2b46331ada44830b', 'f88dfab6-b522-11ee-bb52-506b8d9879b5', 'Charis Healthcare Clinic')
on conflict (bot, chat_id) do nothing;
