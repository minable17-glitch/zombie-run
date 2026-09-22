begin;
alter table zr_private.solo_runs drop constraint if exists solo_runs_mode_check;
alter table zr_private.solo_runs add constraint solo_runs_mode_check check (
 mode in ('free','restricted') or mode ~ '^map:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
create or replace function public.zr_solo_start(p_id uuid,p_mode text,p_pace integer,p_radius integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_runner uuid; r zr_private.solo_runs;
begin
 select runner_id into v_runner from zr_private.runner_sessions where auth_user_id=auth.uid();
 if v_runner is null then raise exception '닉네임과 개인 코드로 먼저 접속해주세요.'; end if;
 if p_id is null or p_mode is null or p_pace is null or p_pace not between 0 and 3
 or p_radius is null or p_radius not between 0 and 3 then raise exception 'Invalid run settings'; end if;
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
 insert into zr_private.solo_runs(id,runner_id,mode,pace,radius)
 values(p_id,v_runner,p_mode,p_pace,case when p_mode='restricted' then p_radius else 0 end) returning * into r;
 return to_jsonb(r)-'runner_id';
end $$;
notify pgrst,'reload schema';
commit;
