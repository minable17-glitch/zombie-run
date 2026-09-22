begin;
create or replace function public.zr_cleanup_finished_rooms() returns void
language sql security definer set search_path='' as $$
 update public.game_rooms r set status='closed'
 where r.host_user_id=auth.uid() and r.status='started'
 and not exists(select 1 from public.room_players p where p.room_id=r.id and p.status='alive');
$$;
revoke all on function public.zr_cleanup_finished_rooms() from public,anon;
grant execute on function public.zr_cleanup_finished_rooms() to authenticated;
notify pgrst,'reload schema';
commit;
