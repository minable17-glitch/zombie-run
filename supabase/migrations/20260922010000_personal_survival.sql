-- Personal runner identity is separate from room codes and administrator accounts.
begin;
create table if not exists zr_private.runners (
 id uuid primary key default gen_random_uuid(), nickname text not null,
 nickname_key text unique not null, code_hash bytea not null,
 created_at timestamptz not null default now()
);
create table if not exists zr_private.runner_sessions (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 runner_id uuid not null references zr_private.runners(id)
);
create table if not exists zr_private.runner_attempts (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 bucket timestamptz not null, hits integer not null
);
create table if not exists zr_private.solo_runs (
 id uuid primary key, runner_id uuid not null references zr_private.runners(id),
 mode text not null check(mode in ('free','restricted')), pace integer not null check(pace between 0 and 3),
 radius integer not null check(radius between 0 and 3),
 elapsed_sec integer not null default 0, distance_m integer not null default 0,
 status text not null default 'alive', started_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), finished_at timestamptz,
 previous_sec integer, is_best boolean not null default false
);
create index if not exists zr_solo_rank on zr_private.solo_runs(mode,pace,radius,runner_id,elapsed_sec desc,distance_m desc) where finished_at is not null;
revoke all on zr_private.runners,zr_private.runner_sessions,zr_private.runner_attempts,zr_private.solo_runs from public,anon,authenticated;

create or replace function public.zr_runner_connect(p_nickname text,p_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_name text:=regexp_replace(trim(p_nickname),'\s+',' ','g'); v_code text;
 r zr_private.runners; v_hits integer;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if v_name is null or length(v_name) not between 1 and 20 then raise exception '닉네임은 1~20자로 입력해주세요.'; end if;
 insert into zr_private.runner_attempts values(auth.uid(),date_trunc('hour',now()),1)
 on conflict(auth_user_id) do update set bucket=date_trunc('hour',now()),
 hits=case when runner_attempts.bucket=date_trunc('hour',now()) then runner_attempts.hits+1 else 1 end
 returning hits into v_hits;
 if v_hits>30 then return jsonb_build_object('error','접속 시도가 많아요. 잠시 후 다시 시도해주세요.'); end if;
 if p_code is null then
  v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,20));
  insert into zr_private.runners(nickname,nickname_key,code_hash)
  values(v_name,lower(v_name),sha256(convert_to(v_code,'UTF8')))
  on conflict(nickname_key) do nothing returning * into r;
  if r.id is null then return jsonb_build_object('error','이미 사용 중인 닉네임이에요. 개인 코드로 접속하거나 다른 닉네임을 골라주세요.'); end if;
 else
  select * into r from zr_private.runners where nickname_key=lower(v_name)
   and code_hash=sha256(convert_to(upper(regexp_replace(p_code,'[\s-]','','g')),'UTF8'));
  if r.id is null then return jsonb_build_object('error','닉네임과 개인 코드를 확인해주세요.'); end if;
 end if;
 insert into zr_private.runner_sessions values(auth.uid(),r.id)
 on conflict(auth_user_id) do update set runner_id=excluded.runner_id;
 return jsonb_build_object('runner',jsonb_build_object('id',r.id,'nickname',r.nickname),'code',v_code);
end $$;

create or replace function public.zr_runner_me() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'nickname',r.nickname) from zr_private.runners r
 join zr_private.runner_sessions s on s.runner_id=r.id where s.auth_user_id=auth.uid();
$$;
create or replace function public.zr_runner_disconnect() returns void
language sql security definer set search_path='' as $$
 delete from zr_private.runner_sessions where auth_user_id=auth.uid();
$$;

create or replace function public.zr_solo_start(p_id uuid,p_mode text,p_pace integer,p_radius integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_runner uuid; r zr_private.solo_runs;
begin
 select runner_id into v_runner from zr_private.runner_sessions where auth_user_id=auth.uid();
 if v_runner is null then raise exception '닉네임과 개인 코드로 먼저 접속해주세요.'; end if;
 if p_id is null or p_mode is null or p_mode not in ('free','restricted') or p_pace is null or p_pace not between 0 and 3
 or p_radius is null or p_radius not between 0 and 3 then raise exception 'Invalid run settings'; end if;
 perform pg_advisory_xact_lock(hashtext(v_runner::text));
 select * into r from zr_private.solo_runs where id=p_id;
 if r.id is not null then
  if r.runner_id<>v_runner then raise exception 'Invalid run'; end if;
  return to_jsonb(r)-'runner_id';
 end if;
 if exists(select 1 from zr_private.solo_runs where runner_id=v_runner and status='alive' and updated_at>now()-interval '30 seconds')
 then raise exception '다른 러닝이 진행 중이에요. 종료하거나 30초 후 다시 시도해주세요.'; end if;
 insert into zr_private.solo_runs(id,runner_id,mode,pace,radius)
 values(p_id,v_runner,p_mode,p_pace,case when p_mode='free' then 0 else p_radius end) returning * into r;
 return to_jsonb(r)-'runner_id';
end $$;

create or replace function public.zr_solo_update(p_id uuid,p_elapsed integer,p_distance double precision,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r zr_private.solo_runs; v_runner uuid; previous zr_private.solo_runs; v_elapsed integer; v_distance integer;
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
 if p_status<>'alive' then
  select * into previous from zr_private.solo_runs where runner_id=v_runner and finished_at is not null
   and mode=r.mode and pace=r.pace and radius=r.radius
   order by elapsed_sec desc,distance_m desc,finished_at limit 1;
 end if;
 update zr_private.solo_runs set elapsed_sec=v_elapsed,distance_m=v_distance,status=p_status,updated_at=now(),
 finished_at=case when p_status<>'alive' then now() end,
 previous_sec=previous.elapsed_sec,
 is_best=p_status<>'alive' and (previous.id is null or (v_elapsed,v_distance)>(previous.elapsed_sec,previous.distance_m))
 where id=p_id returning * into r;
 return to_jsonb(r)-'runner_id';
end $$;

create or replace function public.zr_solo_board(p_mode text,p_pace integer,p_radius integer)
returns jsonb language sql security definer set search_path='' as $$
 with me as (select runner_id from zr_private.runner_sessions where auth_user_id=auth.uid()),
 best as (
  select distinct on (s.runner_id) s.runner_id,s.elapsed_sec,s.distance_m
  from zr_private.solo_runs s where s.finished_at is not null and s.mode=p_mode and s.pace=p_pace
  and s.radius=case when p_mode='free' then 0 else p_radius end
  order by s.runner_id,s.elapsed_sec desc,s.distance_m desc,s.finished_at
 ), ranked as (
  select b.runner_id id,r.nickname,b.elapsed_sec,b.distance_m,
   rank() over(order by b.elapsed_sec desc,b.distance_m desc) rank
  from best b join zr_private.runners r on r.id=b.runner_id
 ), top_players as (select * from ranked order by rank,nickname,id limit 50)
 select jsonb_build_object(
  'players',(select coalesce(jsonb_agg(to_jsonb(t) order by rank,nickname,id),'[]') from top_players t),
  'me',(select to_jsonb(t) from ranked t where id=(select runner_id from me)),
  'total',(select count(*) from ranked),
  'recent',(select coalesce(jsonb_agg(to_jsonb(t) order by finished_at desc),'[]') from (
    select id,elapsed_sec,distance_m,finished_at from zr_private.solo_runs
    where runner_id=(select runner_id from me) and finished_at is not null and mode=p_mode and pace=p_pace
    and radius=case when p_mode='free' then 0 else p_radius end order by finished_at desc limit 5) t)
 );
$$;
revoke all on function public.zr_runner_connect(text,text),public.zr_runner_me(),public.zr_runner_disconnect(),
 public.zr_solo_start(uuid,text,integer,integer),public.zr_solo_update(uuid,integer,double precision,text),
 public.zr_solo_board(text,integer,integer) from public,anon;
grant execute on function public.zr_runner_connect(text,text),public.zr_runner_me(),public.zr_runner_disconnect(),
 public.zr_solo_start(uuid,text,integer,integer),public.zr_solo_update(uuid,integer,double precision,text),
 public.zr_solo_board(text,integer,integer) to authenticated;
notify pgrst,'reload schema';
alter table zr_private.runners enable row level security;
alter table zr_private.runner_sessions enable row level security;
alter table zr_private.runner_attempts enable row level security;
alter table zr_private.solo_runs enable row level security;
commit;
