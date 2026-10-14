-- Let a new personal runner pick their own 6-digit code at signup instead of being
-- handed a system-generated one to copy down — that hand-off step was the main
-- complaint about the "개인 코드" system. The "기존 기록 접속" (login) tab's behavior,
-- including legacy long-code support, is unchanged. Intent (signup vs login) is now
-- an explicit p_create flag from the client instead of being inferred from p_code
-- being null, since both paths now always carry a code.
begin;
drop function if exists public.zr_runner_connect(text,text);

create or replace function public.zr_runner_connect(p_nickname text,p_code text default null,p_create boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_name text:=regexp_replace(trim(p_nickname),'\s+',' ','g');
 r zr_private.runners; v_hits integer;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if v_name is null or length(v_name) not between 1 and 20 then raise exception '닉네임은 1~20자로 입력해주세요.'; end if;
 insert into zr_private.runner_attempts values(auth.uid(),date_trunc('hour',now()),1)
 on conflict(auth_user_id) do update set bucket=date_trunc('hour',now()),
 hits=case when runner_attempts.bucket=date_trunc('hour',now()) then runner_attempts.hits+1 else 1 end
 returning hits into v_hits;
 if v_hits>30 then return jsonb_build_object('error','접속 시도가 많아요. 잠시 후 다시 시도해주세요.'); end if;
 if p_create then
  if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception '숫자 6자리로 개인 코드를 정해주세요.'; end if;
  insert into zr_private.runners(nickname,nickname_key,code_hash)
  values(v_name,lower(v_name),sha256(convert_to(p_code,'UTF8')))
  on conflict(nickname_key) do nothing returning * into r;
  if r.id is null then return jsonb_build_object('error','이미 사용 중인 닉네임이에요. 다른 닉네임을 쓰거나 기존 기록 접속으로 들어와주세요.'); end if;
 else
  select * into r from zr_private.runners where nickname_key=lower(v_name) for update;
  if r.id is not null then
   if r.code_window>now()-interval '15 minutes' and r.code_attempts>=10 then return jsonb_build_object('error','접속 시도가 많아요. 15분 후 다시 시도해주세요.'); end if;
   update zr_private.runners set code_attempts=case when code_window<=now()-interval '15 minutes' then 1 else code_attempts+1 end,code_window=case when code_window<=now()-interval '15 minutes' then now() else code_window end where id=r.id;
  end if;
  select * into r from zr_private.runners where nickname_key=lower(v_name)
   and code_hash=sha256(convert_to(upper(regexp_replace(p_code,'[\s-]','','g')),'UTF8'));
  if r.id is null then return jsonb_build_object('error','닉네임과 개인 코드를 확인해주세요.'); end if;
 end if;
 update zr_private.runners set code_attempts=0,code_window=now() where id=r.id;
 insert into zr_private.runner_sessions values(auth.uid(),r.id)
 on conflict(auth_user_id) do update set runner_id=excluded.runner_id;
 return jsonb_build_object('runner',jsonb_build_object('id',r.id,'nickname',r.nickname));
end $$;

revoke all on function public.zr_runner_connect(text,text,boolean) from public,anon;
grant execute on function public.zr_runner_connect(text,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
