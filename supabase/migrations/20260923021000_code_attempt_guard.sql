begin;
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.zr_runner_connect(text,text)'::regprocedure);
 if position('r.code_attempts>=10' in definition)=0 then
 definition:=regexp_replace(definition,
  '(select \* into r from zr_private.runners where nickname_key=lower\(v_name\)\s+and code_hash=)',
  $patch$select * into r from zr_private.runners where nickname_key=lower(v_name) for update;
  if r.id is not null then
   if r.code_window>now()-interval '15 minutes' and r.code_attempts>=10 then return jsonb_build_object('error','접속 시도가 많아요. 15분 후 다시 시도해주세요.'); end if;
   update zr_private.runners set code_attempts=case when code_window<=now()-interval '15 minutes' then 1 else code_attempts+1 end,code_window=case when code_window<=now()-interval '15 minutes' then now() else code_window end where id=r.id;
  end if;
  \1$patch$);
 end if;
 if position('r.code_attempts>=10' in definition)=0 then raise exception 'Code attempt guard installation failed'; end if;
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
