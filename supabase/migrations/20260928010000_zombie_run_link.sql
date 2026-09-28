-- Notify the 매 1런 running journal when a personal solo run finishes.
-- The shared secret is read from Supabase Vault at call time, never embedded in this function body
-- (function definitions are readable via pg_proc by any authenticated role).
begin;
do $$ begin
 execute 'create extension if not exists pg_net';
exception when others then null;
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
notify pgrst,'reload schema';
commit;
