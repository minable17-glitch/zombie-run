begin;
alter table zr_private.runners add column if not exists code_attempts integer not null default 0;
alter table zr_private.runners add column if not exists code_window timestamptz not null default now();
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.zr_runner_connect(text,text)'::regprocedure);
 definition:=replace(definition,
  'v_code:=upper(substr(replace(gen_random_uuid()::text,''-'',''''),1,20));',
  'v_code:=lpad((((''x''||substr(replace(gen_random_uuid()::text,''-'',''''),1,8))::bit(32)::bigint)%1000000)::text,6,''0'');');
 if position('code_attempts' in definition)=0 then
 definition:=replace(definition,E' else\n  select * into r',E' else\n  select * into r from zr_private.runners where nickname_key=lower(v_name) for update;\n  if r.id is not null then\n   if r.code_window>now()-interval ''15 minutes'' and r.code_attempts>=10 then return jsonb_build_object(''error'',''접속 시도가 많아요. 15분 후 다시 시도해주세요.''); end if;\n   update zr_private.runners set code_attempts=case when code_window<=now()-interval ''15 minutes'' then 1 else code_attempts+1 end,code_window=case when code_window<=now()-interval ''15 minutes'' then now() else code_window end where id=r.id;\n  end if;\n  select * into r');
 definition:=replace(definition,' insert into zr_private.runner_sessions', ' update zr_private.runners set code_attempts=0,code_window=now() where id=r.id; insert into zr_private.runner_sessions');
 end if;
 execute definition;
end $migration$;
create or replace function public.zr_runner_change_code(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_runner uuid;
begin
 if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception '숫자 6자리를 입력해주세요.'; end if;
 select runner_id into v_runner from zr_private.runner_sessions where auth_user_id=auth.uid();
 if v_runner is null then raise exception '개인 기록에 먼저 접속해주세요.'; end if;
 perform pg_advisory_xact_lock(hashtext(v_runner::text));
 update zr_private.runners set code_hash=sha256(convert_to(p_code,'UTF8')),code_attempts=0,code_window=now() where id=v_runner;
 delete from zr_private.runner_sessions where runner_id=v_runner and auth_user_id<>auth.uid();
 return jsonb_build_object('changed',true);
end $$;
revoke all on function public.zr_runner_change_code(text) from public,anon;
grant execute on function public.zr_runner_change_code(text) to authenticated;
notify pgrst,'reload schema';
commit;
