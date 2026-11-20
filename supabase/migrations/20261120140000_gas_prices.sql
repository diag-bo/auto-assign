-- Phụ cấp xăng: every retail price change of Xăng E10 RON 95-III (Vùng 1), kept
-- so a month's hour-weighted average never needs a source again. `at` is VN wall
-- clock; one row per (time, source).
--   'petrolimex' = imported: change time from Petrolimex's own press-release
--                  list, figure from giaxanghomnay.com (Petrolimex publishes its
--                  prices only as pictures). What the allowance uses.
--   'manual'     = typed in the tab; wins over an import at the same time.
--   'pvoil'      = PVOil's figures, read off pvoil.com.vn 2026-11-20 before the
--                  allowance moved to Petrolimex. Kept for reference, never read.
create table if not exists public.gas_prices (
  at timestamp not null,
  price integer not null check (price > 0 and price < 100000),
  source text not null check (source in ('pvoil', 'petrolimex', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (at, source)
);
alter table public.gas_prices enable row level security;

insert into public.gas_prices (at, price, source) values
  ('2026-09-24 15:00', 27080, 'petrolimex'), ('2026-10-01 15:00', 27180, 'petrolimex'),
  ('2026-10-08 15:00', 28250, 'petrolimex'), ('2026-10-15 15:00', 26720, 'petrolimex'),
  ('2026-10-22 15:00', 24910, 'petrolimex'), ('2026-10-29 15:00', 25730, 'petrolimex'),
  ('2026-11-01 00:00', 24150, 'petrolimex'), ('2026-11-03 22:00', 23230, 'petrolimex'),
  ('2026-11-05 15:00', 21150, 'petrolimex'), ('2026-11-12 15:00', 19840, 'petrolimex'),
  ('2026-11-19 15:00', 19100, 'petrolimex'),
  ('2026-08-27 15:00', 22600, 'pvoil'), ('2026-09-03 15:00', 23270, 'pvoil'),
  ('2026-09-10 15:00', 24230, 'pvoil'), ('2026-09-17 15:00', 25630, 'pvoil'),
  ('2026-09-24 15:00', 27080, 'pvoil'), ('2026-10-01 15:00', 27180, 'pvoil'),
  ('2026-10-08 15:00', 28250, 'pvoil'), ('2026-10-15 15:00', 27020, 'pvoil'),
  ('2026-10-16 00:00', 26670, 'pvoil'), ('2026-10-22 15:00', 24860, 'pvoil'),
  ('2026-10-29 15:00', 25730, 'pvoil'), ('2026-11-01 00:00', 24150, 'pvoil'),
  ('2026-11-03 22:00', 23230, 'pvoil'), ('2026-11-05 15:00', 21150, 'pvoil'),
  ('2026-11-12 15:00', 19840, 'pvoil'), ('2026-11-19 15:00', 19100, 'pvoil')
on conflict do nothing;
