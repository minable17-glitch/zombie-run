-- Room-scoped survival rankings, preserving identity checks and terminal records.
begin;
alter table public.room_players add column if not exists elapsed_sec integer not null default 0
 check (elapsed_sec between 0 and 86400);

create or replace function public.zr_update_stat_v2(p_room uuid,p_distance double precision,p_health integer,p_status text,p_elapsed integer)
returns void language plpgsql security definer set search_path='' as $$
declare r public.game_rooms; max_elapsed integer;
begin
 if p_distance is null or not(p_distance between 0 and 1000000)
 or p_health is null or p_health not between 0 and 6
 or p_status is null or p_status not in ('alive','caught','finished')
 or p_elapsed is null or p_elapsed not between 0 and 86400 then raise exception 'Invalid player status'; end if;
 select * into r from public.game_rooms where id=p_room and status='started'
 and created_at>now()-interval '24 hours' for update;
 if r.id is null then raise exception '진행 중인 방이 아니에요.'; end if;
 if not exists(select 1 from public.room_players where room_id=p_room and auth_user_id=auth.uid())
 then raise exception '방 참가 권한이 없어요.'; end if;
 max_elapsed:=greatest(0,floor(extract(epoch from (now()-r.started_at)))::integer);
 update public.room_players set
  elapsed_sec=greatest(elapsed_sec,least(p_elapsed,max_elapsed)),
  distance_m=greatest(distance_m,least(p_distance,max_elapsed*10)),
  health=least(coalesce(health,6),p_health),status=p_status,updated_at=now()
 where room_id=p_room and auth_user_id=auth.uid() and status='alive';
end $$;
revoke all on function public.zr_update_stat_v2(uuid,double precision,integer,text,integer) from public,anon;
grant execute on function public.zr_update_stat_v2(uuid,double precision,integer,text,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
