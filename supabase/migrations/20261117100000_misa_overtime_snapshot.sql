-- The last read of MISA's "waiting for approval" overtime list, so the dashboard's
-- Tăng ca tab opens without a browser login. One row: the morning MISA sync and
-- the tab's "Tải lại" both replace it. Raw MISA rows; checks run on read.
create table if not exists public.misa_overtime_snapshot (
  id text primary key default 'pending',
  rows jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.misa_overtime_snapshot enable row level security;
