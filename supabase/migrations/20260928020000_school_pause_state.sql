-- Remember school-event ("매 1런") linking on the runner row itself so a linked
-- student's traffic-light pause rules keep applying after reconnecting from a
-- different device or session, without re-deriving it from the external service.
begin;
alter table zr_private.runners add column if not exists school_linked_at timestamptz;

create or replace function public.zr_runner_school_link() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_runner uuid; v_at timestamptz;
begin
 select runner_id into v_runner from zr_private.runner_sessions where auth_user_id=auth.uid();
 if v_runner is null then raise exception '개인 기록 접속이 만료됐어요.'; end if;
 update zr_private.runners set school_linked_at=coalesce(school_linked_at,now()) where id=v_runner
 returning school_linked_at into v_at;
 return jsonb_build_object('schoolLinkedAt',v_at);
end $$;

create or replace function public.zr_runner_me() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'nickname',r.nickname,'schoolLinkedAt',r.school_linked_at) from zr_private.runners r
 join zr_private.runner_sessions s on s.runner_id=r.id where s.auth_user_id=auth.uid();
$$;

revoke all on function public.zr_runner_school_link() from public,anon;
grant execute on function public.zr_runner_school_link() to authenticated;
notify pgrst,'reload schema';
commit;
