-- Where a driver's day starts when they did not tap a check-in: the drop-off PSC
-- of their weekday config rules, per shift window (lib/tat.ts configStartFor).
-- One small read for the archive instead of the whole rule and client tables.
create or replace view public.v_driver_start_psc with (security_invoker = true) as
select d->>'driver_id'                                   as driver_id,
       psc.customer_id                                   as psc_id,
       psc.latitude, psc.longitude,
       r.shift_start, r.shift_end,
       count(*) filter (where r.assignment_mode = 'fixed') as fixed_rules,
       count(*)                                          as rules
from public.master_rules_read r
cross join lateral jsonb_array_elements(r.master_rule_drivers::jsonb) d
join public.master_clients c   on c.customer_id = r.pickup_customer_id
join public.master_clients psc on psc.customer_id = coalesce(r.dropoff_customer_id, c.default_dropoff_id, c.nearest_psc_id)
where r.active and r.day_type = 'weekday'
  and psc.latitude is not null and psc.longitude is not null
group by 1, 2, 3, 4, 5, 6;

revoke all on public.v_driver_start_psc from anon, authenticated;
