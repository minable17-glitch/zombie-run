-- "페이스 유지런": accumulate enough time at or above the target pace to succeed,
-- ranked by how fast that was reached (like distance-goal). Unlike distance/time
-- goals, the server can't independently derive "was pace held" from just
-- elapsed/distance — it only has the client's periodic snapshots, not the
-- underlying GPS sample history. So the client reports the moment it reached the
-- goal and the server stores it with light bounds-checking, same trust level the
-- rest of this client-reported game already runs on (see HANDOFF.md).
begin;

alter table zr_private.solo_runs add column if not exists goal_pace_sec integer not null default 0 check (goal_pace_sec between 0 and 3600);
alter table zr_private.solo_runs add column if not exists pace_reached_sec integer;
alter table public.room_players add column if not exists pace_reached_sec integer;

drop function if exists public.zr_solo_start(uuid,text,integer,integer,integer,integer);
create or replace function public.zr_solo_start(p_id uuid,p_mode text,p_pace integer,p_radius integer,p_goal integer default 0,p_goal_sec integer default 0,p_goal_pace_sec integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_runner uuid; r zr_private.solo_runs;
begin
 select runner_id into v_runner from zr_private.runner_sessions where auth_user_id=auth.uid();
 if v_runner is null then raise exception '닉네임과 개인 코드로 먼저 접속해주세요.'; end if;
 if p_id is null or p_mode is null or p_pace is null or p_pace not between 0 and 3
 or p_radius is null or p_radius not between 0 and 3
 or p_goal is null or p_goal<0 or p_goal>50000
 or p_goal_sec is null or p_goal_sec<0 or p_goal_sec>7200
 or p_goal_pace_sec is null or p_goal_pace_sec<0 or p_goal_pace_sec>3600
 or (case when p_goal>0 then 1 else 0 end + case when p_goal_sec>0 then 1 else 0 end
   + case when p_goal_pace_sec>0 then 1 else 0 end)>1 then raise exception 'Invalid run settings'; end if;
 if p_mode not in ('free','restricted') then
  if not exists(select 1 from public.zombie_maps where 'map:'||id::text=p_mode) then
   raise exception '선택한 지도가 없어요. 지도를 다시 선택해주세요.';
  end if;
 end if;
 perform pg_advisory_xact_lock(hashtext(v_runner::text));
 select * into r from zr_private.solo_runs where id=p_id;
 if r.id is not null then
  if r.runner_id<>v_runner then raise exception 'Invalid run'; end if;
  return to_jsonb(r)-'runner_id';
 end if;
 if exists(select 1 from zr_private.solo_runs where runner_id=v_runner and status='alive' and updated_at>now()-interval '30 seconds')
 then raise exception '다른 러닝이 진행 중이에요. 종료하거나 30초 후 다시 시도해주세요.'; end if;
 insert into zr_private.solo_runs(id,runner_id,mode,pace,radius,goal_m,goal_sec,goal_pace_sec)
 values(p_id,v_runner,p_mode,p_pace,case when p_mode='restricted' then p_radius else 0 end,p_goal,p_goal_sec,p_goal_pace_sec) returning * into r;
 return to_jsonb(r)-'runner_id';
end $$;

drop function if exists public.zr_solo_update(uuid,integer,double precision,text);
create or replace function public.zr_solo_update(p_id uuid,p_elapsed integer,p_distance double precision,p_status text,p_pace_reached_sec integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r zr_private.solo_runs; v_runner uuid; previous zr_private.solo_runs;
 v_elapsed integer; v_distance integer; v_goal_reached integer; v_goal_reached_m integer; v_pace_reached integer;
begin
 select runner_id into v_runner from zr_private.runner_sessions where auth_user_id=auth.uid();
 if v_runner is null then raise exception '개인 기록 접속이 만료됐어요.'; end if;
 if p_elapsed is null or p_elapsed not between 0 and 86400 or p_distance is null
 or not(p_distance between 0 and 1000000) or p_status is null or p_status not in ('alive','finished','caught')
 then raise exception 'Invalid run record'; end if;
 perform pg_advisory_xact_lock(hashtext(v_runner::text));
 select * into r from zr_private.solo_runs where id=p_id and runner_id=v_runner for update;
 if r.id is null then raise exception '내 러닝 기록이 아니에요.'; end if;
 if r.status<>'alive' then return to_jsonb(r)-'runner_id'; end if;
 v_elapsed:=greatest(r.elapsed_sec,least(p_elapsed,greatest(0,floor(extract(epoch from now()-r.started_at)))::integer));
 v_distance:=greatest(r.distance_m,least(round(p_distance)::integer,v_elapsed*10));
 -- 거리 목표는 "얼마나 빨리 찍었는지"(goal_reached_sec), 시간 목표는 "그 시간 동안 얼마나 멀리 갔는지"(goal_reached_m),
 -- 페이스 유지 목표는 클라이언트가 보고하는 "누적 유지 목표를 채운 시점"(pace_reached_sec)으로 가림
 v_goal_reached:=case when r.goal_m>0 and r.goal_reached_sec is null and v_distance>=r.goal_m then v_elapsed else r.goal_reached_sec end;
 v_goal_reached_m:=case when r.goal_sec>0 and r.goal_reached_m is null and v_elapsed>=r.goal_sec then v_distance else r.goal_reached_m end;
 v_pace_reached:=case when r.goal_pace_sec>0 and r.pace_reached_sec is null and p_pace_reached_sec is not null
  then least(greatest(p_pace_reached_sec,0),v_elapsed) else r.pace_reached_sec end;
 if p_status<>'alive' then
  if r.goal_m>0 then
   select * into previous from zr_private.solo_runs where runner_id=v_runner and finished_at is not null
    and mode=r.mode and pace=r.pace and radius=r.radius and goal_m=r.goal_m and goal_reached_sec is not null
    order by goal_reached_sec asc,finished_at limit 1;
  elsif r.goal_sec>0 then
   select * into previous from zr_private.solo_runs where runner_id=v_runner and finished_at is not null
    and mode=r.mode and pace=r.pace and radius=r.radius and goal_sec=r.goal_sec and goal_reached_m is not null
    order by goal_reached_m desc,finished_at limit 1;
  elsif r.goal_pace_sec>0 then
   select * into previous from zr_private.solo_runs where runner_id=v_runner and finished_at is not null
    and mode=r.mode and pace=r.pace and radius=r.radius and goal_pace_sec=r.goal_pace_sec and pace_reached_sec is not null
    order by pace_reached_sec asc,finished_at limit 1;
  else
   select * into previous from zr_private.solo_runs where runner_id=v_runner and finished_at is not null
    and mode=r.mode and pace=r.pace and radius=r.radius and goal_m=0 and goal_sec=0 and goal_pace_sec=0
    order by elapsed_sec desc,distance_m desc,finished_at limit 1;
  end if;
 end if;
 update zr_private.solo_runs set elapsed_sec=v_elapsed,distance_m=v_distance,status=p_status,updated_at=now(),
 finished_at=case when p_status<>'alive' then now() end,
 goal_reached_sec=v_goal_reached,
 goal_reached_m=v_goal_reached_m,
 pace_reached_sec=v_pace_reached,
 previous_sec=case when r.goal_m>0 then previous.goal_reached_sec when r.goal_sec>0 or r.goal_pace_sec>0 then null else previous.elapsed_sec end,
 is_best=p_status<>'alive' and (case when r.goal_m>0
   then v_goal_reached is not null and (previous.id is null or v_goal_reached<previous.goal_reached_sec)
   when r.goal_sec>0
   then v_goal_reached_m is not null and (previous.id is null or v_goal_reached_m>previous.goal_reached_m)
   when r.goal_pace_sec>0
   then v_pace_reached is not null and (previous.id is null or v_pace_reached<previous.pace_reached_sec)
   else previous.id is null or (v_elapsed,v_distance)>(previous.elapsed_sec,previous.distance_m) end)
 where id=p_id returning * into r;
 if p_status<>'alive' then
  begin
   perform net.http_post(
    url:='https://running-journal-wine.vercel.app/api/zombie-run/record',
    headers:=jsonb_build_object(
     'Content-Type','application/json',
     'x-zombie-run-secret',(select decrypted_secret from vault.decrypted_secrets where name='zombie_run_shared_secret')
    ),
    body:=jsonb_build_object(
     'zombieRunnerId',v_runner,'distanceM',v_distance,'elapsedSec',v_elapsed,'finishedAt',r.finished_at
    )
   );
  exception when others then raise warning 'zombie_run record notify failed: %',sqlerrm;
  end;
 end if;
 return to_jsonb(r)-'runner_id';
end $$;

drop function if exists public.zr_solo_board(text,integer,integer,integer,integer);
create or replace function public.zr_solo_board(p_mode text,p_pace integer,p_radius integer,p_goal integer default 0,p_goal_sec integer default 0,p_goal_pace_sec integer default 0)
returns jsonb language sql security definer set search_path='' as $$
 with me as (select runner_id from zr_private.runner_sessions where auth_user_id=auth.uid()),
 best as (
  select distinct on (s.runner_id) s.runner_id,s.elapsed_sec,s.distance_m,s.goal_reached_sec,s.goal_reached_m,s.pace_reached_sec
  from zr_private.solo_runs s where s.finished_at is not null and s.mode=p_mode and s.pace=p_pace
  and s.radius=case when p_mode='free' then 0 else p_radius end and s.goal_m=p_goal and s.goal_sec=p_goal_sec and s.goal_pace_sec=p_goal_pace_sec
  and ((p_goal=0 and p_goal_sec=0 and p_goal_pace_sec=0) or (p_goal>0 and s.goal_reached_sec is not null)
   or (p_goal_sec>0 and s.goal_reached_m is not null) or (p_goal_pace_sec>0 and s.pace_reached_sec is not null))
  order by s.runner_id,
   case when p_goal>0 then s.goal_reached_sec end asc,
   case when p_goal_sec>0 then s.goal_reached_m end desc,
   case when p_goal_pace_sec>0 then s.pace_reached_sec end asc,
   case when p_goal=0 and p_goal_sec=0 and p_goal_pace_sec=0 then s.elapsed_sec end desc,
   case when p_goal=0 and p_goal_sec=0 and p_goal_pace_sec=0 then s.distance_m end desc,
   s.finished_at
 ), ranked as (
  select b.runner_id id,r.nickname,b.elapsed_sec,b.distance_m,b.goal_reached_sec,b.goal_reached_m,b.pace_reached_sec,
   rank() over(order by
    case when p_goal>0 then b.goal_reached_sec end asc,
    case when p_goal_sec>0 then b.goal_reached_m end desc,
    case when p_goal_pace_sec>0 then b.pace_reached_sec end asc,
    case when p_goal=0 and p_goal_sec=0 and p_goal_pace_sec=0 then b.elapsed_sec end desc,
    case when p_goal=0 and p_goal_sec=0 and p_goal_pace_sec=0 then b.distance_m end desc
   ) rank
  from best b join zr_private.runners r on r.id=b.runner_id
 ), top_players as (select * from ranked order by rank,nickname,id limit 50)
 select jsonb_build_object(
  'players',(select coalesce(jsonb_agg(to_jsonb(t) order by rank,nickname,id),'[]') from top_players t),
  'me',(select to_jsonb(t) from ranked t where id=(select runner_id from me)),
  'total',(select count(*) from ranked),
  'recent',(select coalesce(jsonb_agg(to_jsonb(t) order by finished_at desc),'[]') from (
    select id,elapsed_sec,distance_m,goal_reached_sec,goal_reached_m,pace_reached_sec,finished_at from zr_private.solo_runs
    where runner_id=(select runner_id from me) and finished_at is not null and mode=p_mode and pace=p_pace
    and radius=case when p_mode='free' then 0 else p_radius end and goal_m=p_goal and goal_sec=p_goal_sec and goal_pace_sec=p_goal_pace_sec
    order by finished_at desc limit 5) t)
 );
$$;

create or replace function public.zr_create_room(p_nickname text,p_config jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.game_rooms; p public.room_players; v_config jsonb; v_code text; attempt integer;
 v_goal integer; v_goal_sec integer; v_goal_pace_sec integer;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_nickname is null or length(trim(p_nickname)) not between 1 and 20 then raise exception '닉네임은 1~20자예요.'; end if;
 if p_config is null or jsonb_typeof(p_config)<>'object' then raise exception 'Invalid room config'; end if;
 if coalesce(p_config->>'paceIdx','1') !~ '^[0-3]$' then raise exception 'Invalid pace'; end if;
 if coalesce(p_config->>'missionGoalM','0') !~ '^[0-9]+$' then raise exception 'Invalid goal distance'; end if;
 if coalesce(p_config->>'missionGoalSec','0') !~ '^[0-9]+$' then raise exception 'Invalid goal time'; end if;
 if coalesce(p_config->>'missionGoalPaceSec','0') !~ '^[0-9]+$' then raise exception 'Invalid goal pace'; end if;
 v_goal:=coalesce(p_config->>'missionGoalM','0')::int;
 v_goal_sec:=coalesce(p_config->>'missionGoalSec','0')::int;
 v_goal_pace_sec:=coalesce(p_config->>'missionGoalPaceSec','0')::int;
 if v_goal>50000 or v_goal_sec>7200 or v_goal_pace_sec>3600
  or (case when v_goal>0 then 1 else 0 end + case when v_goal_sec>0 then 1 else 0 end
    + case when v_goal_pace_sec>0 then 1 else 0 end)>1 then raise exception 'Invalid goal'; end if;
 if p_config ? 'mapId' then
  if not exists(select 1 from public.zombie_maps where id=(p_config->>'mapId')::uuid) then raise exception '지도를 찾을 수 없어요.'; end if;
  v_config:=jsonb_build_object('paceIdx',coalesce(p_config->>'paceIdx','1')::int,'mapId',p_config->>'mapId',
   'missionGoalM',v_goal,'missionGoalSec',v_goal_sec,'missionGoalPaceSec',v_goal_pace_sec,
   'missionContinue',coalesce((p_config->>'missionContinue')::boolean,false));
 else
  if coalesce(p_config->>'radiusIdx','1') !~ '^[0-3]$'
    or coalesce(p_config->>'playMode','free') not in ('free','restricted') then raise exception 'Invalid room settings'; end if;
  v_config:=jsonb_build_object('paceIdx',coalesce(p_config->>'paceIdx','1')::int,
   'radiusIdx',coalesce(p_config->>'radiusIdx','1')::int,'playMode',coalesce(p_config->>'playMode','free'),
   'missionGoalM',v_goal,'missionGoalSec',v_goal_sec,'missionGoalPaceSec',v_goal_pace_sec,
   'missionContinue',coalesce((p_config->>'missionContinue')::boolean,false));
 end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if (select count(*) from public.game_rooms where host_user_id=auth.uid() and created_at>now()-interval '24 hours' and status<>'closed')>=5
 then raise exception '열려 있는 방을 먼저 닫아주세요.'; end if;
 for attempt in 1..5 loop
  v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  begin
   insert into public.game_rooms(code,host_name,host_user_id,config) values(v_code,trim(p_nickname),auth.uid(),v_config) returning * into r;
   exit;
  exception when unique_violation then
   if attempt=5 then raise; end if;
  end;
 end loop;
 insert into public.room_players(room_id,nickname,auth_user_id,health)
 values(r.id,trim(p_nickname),auth.uid(),6) returning * into p;
 return jsonb_build_object('room',to_jsonb(r)-'host_user_id','player',to_jsonb(p)-'auth_user_id');
end $$;

drop function if exists public.zr_update_stat_v2(uuid,double precision,integer,text,integer);
create or replace function public.zr_update_stat_v2(p_room uuid,p_distance double precision,p_health integer,p_status text,p_elapsed integer,p_pace_reached_sec integer default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.game_rooms; max_elapsed integer; v_goal integer; v_goal_sec integer; v_goal_pace_sec integer;
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
 v_goal:=coalesce((r.config->>'missionGoalM')::int,0);
 v_goal_sec:=coalesce((r.config->>'missionGoalSec')::int,0);
 v_goal_pace_sec:=coalesce((r.config->>'missionGoalPaceSec')::int,0);
 update public.room_players set
  elapsed_sec=greatest(elapsed_sec,least(p_elapsed,max_elapsed)),
  distance_m=greatest(distance_m,least(p_distance,max_elapsed*10)),
  health=least(coalesce(health,6),p_health),status=p_status,updated_at=now(),
  goal_reached_sec=case when goal_reached_sec is null and v_goal>0
   and least(p_distance,max_elapsed*10)>=v_goal then least(p_elapsed,max_elapsed) else goal_reached_sec end,
  goal_reached_m=case when goal_reached_m is null and v_goal_sec>0
   and least(p_elapsed,max_elapsed)>=v_goal_sec then least(p_distance,max_elapsed*10) else goal_reached_m end,
  pace_reached_sec=case when pace_reached_sec is null and v_goal_pace_sec>0 and p_pace_reached_sec is not null
   then least(greatest(p_pace_reached_sec,0),least(p_elapsed,max_elapsed)) else pace_reached_sec end
 where room_id=p_room and auth_user_id=auth.uid() and status='alive';
end $$;

revoke all on function public.zr_solo_start(uuid,text,integer,integer,integer,integer,integer),
 public.zr_solo_update(uuid,integer,double precision,text,integer),
 public.zr_solo_board(text,integer,integer,integer,integer,integer),
 public.zr_update_stat_v2(uuid,double precision,integer,text,integer,integer) from public,anon;
grant execute on function public.zr_solo_start(uuid,text,integer,integer,integer,integer,integer),
 public.zr_solo_update(uuid,integer,double precision,text,integer),
 public.zr_solo_board(text,integer,integer,integer,integer,integer),
 public.zr_update_stat_v2(uuid,double precision,integer,text,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
