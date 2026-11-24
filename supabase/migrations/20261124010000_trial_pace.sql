-- 체험 판 좀비 속도 고르기: 판마다 좀비 페이스(0=5'30" 1=6'00" 2=6'30" 3=7'00"/km)를 남기고,
-- 빠른 좀비일수록 점수에 배율(×1.3 ×1.2 ×1.1 ×1)을 곱한다. 순위표는 그대로 실내/실외 · 시간별 하나.
-- 옛 3인자 zr_trial_start 는 지우고 p_pace 기본값 3(7'00")을 둔 새 함수로 바꾼다 — 이 SQL 을 먼저 돌려도 지금 화면이 그대로 동작한다.
begin;

alter table zr_private.trial_runs add column if not exists pace smallint not null default 3 check (pace between 0 and 3);

drop function if exists public.zr_trial_start(text,boolean,integer);
create or replace function public.zr_trial_start(p_name text,p_indoor boolean,p_seconds integer,p_pace integer default 3)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_name text := btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g')); v_id uuid;
begin
 if char_length(v_name) not between 1 and 10 then raise exception '이름은 1~10자로 적어주세요.'; end if;
 if p_indoor is null or p_seconds is null or p_seconds not in (30,60,120) or p_pace is null or p_pace not between 0 and 3
 then raise exception 'Invalid trial settings'; end if;
 insert into zr_private.trial_runs(name,indoor,seconds,pace) values(v_name,p_indoor,p_seconds,p_pace) returning id into v_id;
 return v_id;
end $$;

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
  v_score := round((v_survived*10+v_lives*100+v_distance)*(array[1.3,1.2,1.1,1.0])[r.pace+1]);
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
  'pace',r.pace,'best',v_best,'rank',v_rank);
end $$;

create or replace function public.zr_trial_board(p_indoor boolean,p_seconds integer,p_limit integer default 20)
returns jsonb language sql stable security definer set search_path='' as $$
 with best as (
  select distinct on (name) name,score,survived_sec,lives,distance_m,pace,finished_at
  from zr_private.trial_runs
  where day=(now() at time zone 'Asia/Seoul')::date and indoor=p_indoor and seconds=p_seconds and score is not null
  order by name,score desc,finished_at
 ), ranked as (
  select *,rank() over (order by score desc) rnk from best
 )
 select coalesce(jsonb_agg(jsonb_build_object('rank',rnk,'name',name,'score',score,'survived',survived_sec,'lives',lives,'distance',distance_m,'pace',pace)
  order by rnk,finished_at),'[]'::jsonb)
 from (select * from ranked order by rnk,finished_at limit least(greatest(coalesce(p_limit,20),1),50)) t
$$;

revoke all on function public.zr_trial_start(text,boolean,integer,integer) from public;
grant execute on function public.zr_trial_start(text,boolean,integer,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
