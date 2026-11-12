-- A location gone from Cartrack is retired IN CONFIG, not only flagged: every active
-- rule naming it (pickup, drop-off match or alternate drop-off, weekday and Sunday)
-- either moves to its replacement or is switched off, and the location is marked
-- {inactive} the way Cartrack marks one, so nothing can be pointed at it again.
-- Rules keep their id, drivers, hours and areas; each change is in master_record_changes.
create function public.master_retire_missing_client(p_id uuid,expected_missing_at timestamptz,p_to uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actual timestamptz; target public.master_clients; before_row public.master_config_rules; after_row public.master_config_rules;
  ids jsonb; moved bigint[]:='{}'; switched_off int:=0;
begin
  perform pg_advisory_xact_lock(873652901);  -- the same lock master_write_rules takes
  select cartrack_missing_at into actual from public.master_clients where customer_id=p_id for update;
  if actual is null or actual is distinct from expected_missing_at then raise exception 'Danh sách đã thay đổi; tải lại trước khi xử lý'; end if;
  if p_to is not null then
    select * into target from public.master_clients where customer_id=p_to;
    if target.customer_id is null or target.cartrack_missing_at is not null or not target.is_active or p_to=p_id then
      raise exception 'Địa điểm thay thế không hợp lệ hoặc không còn trên Cartrack';
    end if;
  end if;
  for before_row in select * from public.master_config_rules where active
      and p_id in (pickup_customer_id,dropoff_customer_id,alternate_dropoff_customer_id) order by id for update loop
    select coalesce(jsonb_agg(driver_id::text order by selection_order),'[]') into ids from public.master_rule_drivers where rule_id=before_row.id;
    if p_to is null then
      update public.master_config_rules set active=false,revision=revision+1,updated_at=now() where id=before_row.id returning * into after_row;
      switched_off:=switched_off+1;
    else
      update public.master_config_rules set
        pickup_customer_id=case when pickup_customer_id=p_id then p_to else pickup_customer_id end,
        dropoff_customer_id=case when dropoff_customer_id=p_id then p_to else dropoff_customer_id end,
        alternate_dropoff_customer_id=case when alternate_dropoff_customer_id=p_id then p_to else alternate_dropoff_customer_id end,
        revision=revision+1,updated_at=now() where id=before_row.id returning * into after_row;
      moved:=moved||after_row.id;
    end if;
    insert into public.master_record_changes(rule_id,before_data,after_data)
    values(after_row.id,(to_jsonb(before_row)-'row_data')||jsonb_build_object('driver_ids',ids),(to_jsonb(after_row)-'row_data')||jsonb_build_object('driver_ids',ids));
  end loop;
  -- The engine's driver-less placeholder on the replacement is superseded by the moved rules.
  if p_to is not null and exists(select 1 from public.master_config_rules where id=any(moved) and day_type='weekday' and pickup_customer_id=p_to) then
    for before_row in select * from public.master_config_rules r where active and day_type='weekday' and pickup_customer_id=p_to
        and not(id=any(moved)) and not exists(select 1 from public.master_rule_drivers d where d.rule_id=r.id) for update loop
      update public.master_config_rules set active=false,revision=revision+1,updated_at=now() where id=before_row.id returning * into after_row;
      insert into public.master_record_changes(rule_id,before_data,after_data)
      values(after_row.id,(to_jsonb(before_row)-'row_data')||'{"driver_ids":[]}',(to_jsonb(after_row)-'row_data')||'{"driver_ids":[]}');
      switched_off:=switched_off+1;
    end loop;
  end if;
  update public.master_clients set cartrack=jsonb_set(cartrack,'{customer_name}',to_jsonb('{inactive} '||coalesce(cartrack->>'customer_name','')))
  where customer_id=p_id and is_active;
  return jsonb_build_object('moved',cardinality(moved),'switched_off',switched_off);
end $$;
revoke all on function public.master_retire_missing_client(uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.master_retire_missing_client(uuid,timestamptz,uuid) to service_role;

-- A Labcenter finding a supervisor has looked at and chosen to leave. Keyed by the
-- finding's exact wording, so a DIFFERENT finding on the same location still shows.
create table public.master_sync_issue_ignores (
  customer_id text not null, kind text not null, detail text not null,
  ignored_at timestamptz not null default now(),
  primary key (customer_id,kind,detail)
);
alter table public.master_sync_issue_ignores enable row level security;
revoke all on public.master_sync_issue_ignores from anon,authenticated;
