begin;
create or replace function public.zr_ensure_profile() returns void
language plpgsql security definer set search_path='' as $$
declare u auth.users; v_username text;
begin
 select * into u from auth.users where id=auth.uid();
 if u.id is null or coalesce(u.is_anonymous,false) then raise exception 'Sign in required'; end if;
 -- Existing profiles are authoritative for legacy accounts without username metadata.
 update public.profiles set email=lower(u.email) where id=u.id;
 if found then return; end if;
 v_username := lower(trim(u.raw_user_meta_data->>'username'));
 if coalesce(u.raw_user_meta_data->>'app','zombie-run') <> 'zombie-run'
   or v_username is null or v_username !~ '^[a-z0-9_]{3,20}$' then
   raise exception 'No Zombie Run username';
 end if;
 insert into public.profiles(id,username,email) values(u.id,v_username,lower(u.email))
 on conflict(id) do update set email=excluded.email;
end $$;
revoke all on function public.zr_ensure_profile() from public, anon;
grant execute on function public.zr_ensure_profile() to authenticated;
notify pgrst, 'reload schema';
commit;
