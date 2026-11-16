-- Lương PT "Không ca" quick fix: a day the supervisor decided NOT to pay
-- (2026-11-16). The day stays unpaid exactly as the rule leaves it; this row only
-- takes it off the open count. Deleting the row (Hoàn tác) puts it back.
-- Kept apart from pay_day_corrections on purpose: a rejected row there would read
-- as a driver's request in Cập nhật công and on the driver's Thu Nhập screen.
create table if not exists public.pay_no_shift_reviews (
  driver_id  uuid        not null,
  trip_date  date        not null,
  note       text        not null default '',
  decided_at timestamptz not null default now(),
  primary key (driver_id, trip_date)
);
alter table public.pay_no_shift_reviews enable row level security;
