-- Close expired rooms without deleting participant records.
begin;
create or replace function public.zr_expire_rooms()
returns integer language plpgsql security definer set search_path = public
as $$
declare affected integer;
begin
  update public.game_rooms set status = 'closed'
  where status <> 'closed' and created_at <= now() - interval '24 hours';
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.zr_expire_rooms() from public, anon, authenticated;
grant execute on function public.zr_expire_rooms() to service_role;

create or replace function public.zr_expire_rooms_on_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.zr_expire_rooms();
  return new;
end;
$$;
revoke all on function public.zr_expire_rooms_on_insert() from public, anon, authenticated;
drop trigger if exists zr_expire_rooms_on_insert on public.game_rooms;
create trigger zr_expire_rooms_on_insert before insert on public.game_rooms
for each statement execute function public.zr_expire_rooms_on_insert();
commit;

