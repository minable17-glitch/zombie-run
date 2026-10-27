-- 로그인 없는 체험 판 순위: 이름만 넣고 하는 짧은 생존(30초/1분/2분 · 실내/실외)의 "오늘" 순위.
-- 점수 = 버틴 초 × 10 + 남은 생명 × 100 + 달린 거리(m). 같은 날·같은 판(실내/실외·시간)에서 이름별 최고 점수만 보인다.
-- 로그인이 없으니 누구나(anon) 부를 수 있다. 시작 때 서버 시각을 남기고, 끝낼 때 버틴 시간을 그 시각 기준으로 막는다.
-- 날짜는 한국 시간 기준.
begin;

create table if not exists zr_private.trial_runs (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(name) between 1 and 10),
 indoor boolean not null,
 seconds integer not null check (seconds in (30,60,120)),
 day date not null default (now() at time zone 'Asia/Seoul')::date,
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 survived_sec integer,
 lives integer,
 distance_m integer,
 score integer
);
create index if not exists trial_runs_board_idx on zr_private.trial_runs(day,indoor,seconds,score desc) where score is not null;
revoke all on zr_private.trial_runs from public,anon,authenticated;

create or replace function public.zr_trial_start(p_name text,p_indoor boolean,p_seconds integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_name text := btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g')); v_id uuid;
begin
 if char_length(v_name) not between 1 and 10 then raise exception '이름은 1~10자로 적어주세요.'; end if;
 if p_indoor is null or p_seconds is null or p_seconds not in (30,60,120) then raise exception 'Invalid trial settings'; end if;
 insert into zr_private.trial_runs(name,indoor,seconds) values(v_name,p_indoor,p_seconds) returning id into v_id;
 return v_id;
end $$;

-- 한 판에 한 번만 기록된다. 버틴 시간은 판 길이와 시작 후 실제로 흐른 시간(+2초 여유)을 넘을 수 없고,
-- 거리는 초당 6m(빠른 달리기)까지만 인정한다. 돌려주는 값: 내 점수와 오늘 순위(이름별 최고 기준).
create or replace function public.zr_trial_finish(p_id uuid,p_survived integer,p_lives integer,p_distance integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r zr_private.trial_runs; v_survived integer; v_lives integer; v_distance integer; v_score integer; v_best integer; v_rank integer;
begin
 if p_id is null or p_survived is null or p_lives is null or p_distance is null then raise exception 'Invalid trial record'; end if;
 select * into r from zr_private.trial_runs where id=p_id for update;
 if r.id is null then raise exception '체험 기록을 찾을 수 없어요.'; end if;
 if r.score is null then
  v_survived := least(greatest(p_survived,0),r.seconds,floor(extract(epoch from now()-r.started_at))::integer+2);
  v_lives := case when v_survived>=r.seconds then least(greatest(p_lives,0),3) else 0 end;
  v_distance := least(greatest(p_distance,0),v_survived*6);
  v_score := v_survived*10+v_lives*100+v_distance;
  update zr_private.trial_runs set finished_at=now(),survived_sec=v_survived,lives=v_lives,distance_m=v_distance,score=v_score
  where id=p_id returning * into r;
 end if;
 select max(score) into v_best from zr_private.trial_runs
 where day=r.day and indoor=r.indoor and seconds=r.seconds and name=r.name and score is not null;
 select count(*)+1 into v_rank from (
  select max(score) best from zr_private.trial_runs
  where day=r.day and indoor=r.indoor and seconds=r.seconds and score is not null and name<>r.name group by name
 ) o where o.best>v_best;
 return jsonb_build_object('name',r.name,'score',r.score,'survived',r.survived_sec,'lives',r.lives,'distance',r.distance_m,
  'best',v_best,'rank',v_rank);
end $$;

-- 오늘(한국 시간) 같은 판의 이름별 최고 점수 상위 p_limit 명
create or replace function public.zr_trial_board(p_indoor boolean,p_seconds integer,p_limit integer default 20)
returns jsonb language sql stable security definer set search_path='' as $$
 with best as (
  select distinct on (name) name,score,survived_sec,lives,distance_m,finished_at
  from zr_private.trial_runs
  where day=(now() at time zone 'Asia/Seoul')::date and indoor=p_indoor and seconds=p_seconds and score is not null
  order by name,score desc,finished_at
 ), ranked as (
  select *,rank() over (order by score desc) rnk from best
 )
 select coalesce(jsonb_agg(jsonb_build_object('rank',rnk,'name',name,'score',score,'survived',survived_sec,'lives',lives,'distance',distance_m)
  order by rnk,finished_at),'[]'::jsonb)
 from (select * from ranked order by rnk,finished_at limit least(greatest(coalesce(p_limit,20),1),50)) t
$$;

revoke all on function public.zr_trial_start(text,boolean,integer),public.zr_trial_finish(uuid,integer,integer,integer),
 public.zr_trial_board(boolean,integer,integer) from public;
grant execute on function public.zr_trial_start(text,boolean,integer),public.zr_trial_finish(uuid,integer,integer,integer),
 public.zr_trial_board(boolean,integer,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
