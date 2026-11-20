-- Phụ cấp xăng: one month's ridden km per driver account, summed in the database
-- so the tab reads ~150 rows instead of paging ~30k legs. Legs are TAT legs —
-- the same stop-to-stop km the allowance sheet has always summed.
create or replace function public.gas_km_by_driver(p_from date, p_to date)
returns table (driver_id text, name text, km numeric, legs bigint)
language sql stable
set search_path = public
as $$
  select t.driver_id::text,
         trim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, '')),
         round(sum(t.distance_km)::numeric, 2),
         count(*)
  from tat_legs t
  left join master_drivers d on d.driver_id = t.driver_id
  where t.trip_date between p_from and p_to
  group by 1, 2
$$;
revoke all on function public.gas_km_by_driver(date, date) from public, anon, authenticated;
