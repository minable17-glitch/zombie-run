begin;

-- This migration only changes Zombie Run tables and zr_* functions.
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text unique not null, email text not null,
 created_at timestamptz not null default now()
);
do $$ begin
 if exists(select lower(trim(username)) from public.profiles group by 1 having count(*) > 1) then
  raise exception 'Resolve case-insensitive duplicate usernames before migrating';
 end if;
end $$;
update public.profiles set username=lower(trim(username)) where username<>lower(trim(username));
create unique index if not exists zr_profiles_username_normalized on public.profiles(lower(username));
alter table public.profiles enable row level security;
drop policy if exists "Anyone can look up username" on public.profiles;
drop policy if exists "Users can create own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists zr_profile_read_own on public.profiles;
create policy zr_profile_read_own on public.profiles for select to authenticated using(id=auth.uid());
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.profiles to service_role;

-- Retire only the known legacy Zombie Run trigger, never another app's trigger.
do $$ begin
 if exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
  where t.tgrelid='auth.users'::regclass and t.tgname='on_auth_user_created'
  and t.tgfoid=to_regprocedure('public.handle_new_user()')
  and position('insert into public.profiles' in lower(pg_get_functiondef(p.oid)))>0) then
   drop trigger on_auth_user_created on auth.users;
 end if;
end $$;

create or replace function public.zr_handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_username text := lower(trim(new.raw_user_meta_data->>'username'));
begin
 -- Other apps and guest accounts on this shared Auth project are untouched.
 if coalesce(new.raw_user_meta_data->>'app','zombie-run') <> 'zombie-run'
    or v_username is null or coalesce(new.is_anonymous,false) then return new; end if;
 if v_username !~ '^[a-z0-9_]{3,20}$' or new.email is null then
  raise exception 'Invalid Zombie Run account';
 end if;
 insert into public.profiles(id,username,email)
 values(new.id,v_username,lower(new.email)) on conflict(id) do nothing;
 return new;
end $$;
revoke all on function public.zr_handle_new_user() from public, anon, authenticated;
drop trigger if exists zr_auth_user_created on auth.users;
create trigger zr_auth_user_created after insert on auth.users
 for each row execute function public.zr_handle_new_user();

create or replace function public.zr_sync_profile_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.email is not null then
  update public.profiles set email=lower(new.email) where id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.zr_sync_profile_email() from public,anon,authenticated;
drop trigger if exists zr_auth_email_changed on auth.users;
create trigger zr_auth_email_changed after update of email on auth.users
 for each row execute function public.zr_sync_profile_email();
update public.profiles p set email=lower(u.email) from auth.users u
 where p.id=u.id and u.email is not null and p.email is distinct from lower(u.email);

create or replace function public.zr_ensure_profile() returns void
language plpgsql security definer set search_path='' as $$
declare u auth.users; v_username text;
begin
 select * into u from auth.users where id=auth.uid();
 if u.id is null or coalesce(u.is_anonymous,false) then raise exception 'Sign in required'; end if;
 v_username := lower(trim(u.raw_user_meta_data->>'username'));
 if v_username is null or v_username !~ '^[a-z0-9_]{3,20}$' then raise exception 'No Zombie Run username'; end if;
 insert into public.profiles(id,username,email) values(u.id,v_username,lower(u.email))
 on conflict(id) do update set email=excluded.email;
end $$;
revoke all on function public.zr_ensure_profile() from public, anon;
grant execute on function public.zr_ensure_profile() to authenticated;

-- Repair only legacy accounts carrying the Zombie Run username metadata.
-- Abort on conflicts instead of silently replacing another person's username.
insert into public.profiles(id,username,email)
 select u.id,lower(trim(u.raw_user_meta_data->>'username')),lower(u.email)
 from auth.users u
 where lower(trim(u.raw_user_meta_data->>'username')) ~ '^[a-z0-9_]{3,20}$'
 and coalesce(u.raw_user_meta_data->>'app','zombie-run')='zombie-run'
 and not coalesce(u.is_anonymous,false) and u.email is not null
 and not exists(select 1 from public.profiles p where p.id=u.id);

create table if not exists public.zombie_maps (
 id uuid primary key default gen_random_uuid(), name text not null,
 center_lat double precision not null, center_lon double precision not null,
 radius_m integer not null, routes jsonb not null,
 owner_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
alter table public.zombie_maps add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.zombie_maps enable row level security;
drop policy if exists "Anyone can read zombie maps" on public.zombie_maps;
drop policy if exists "Anyone can add zombie maps" on public.zombie_maps;
drop policy if exists "Authenticated can add zombie maps" on public.zombie_maps;
drop policy if exists "Anyone can edit zombie maps" on public.zombie_maps;
drop policy if exists "Authenticated can edit zombie maps" on public.zombie_maps;
drop policy if exists "Owner can edit own zombie maps" on public.zombie_maps;
drop policy if exists "Anyone can delete zombie maps" on public.zombie_maps;
drop policy if exists "Authenticated can delete zombie maps" on public.zombie_maps;
drop policy if exists "Owner can delete own zombie maps" on public.zombie_maps;
create policy "Anyone can read zombie maps" on public.zombie_maps for select using(true);
create policy "Authenticated can add zombie maps" on public.zombie_maps for insert to authenticated
 with check(owner_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid()));
create policy "Owner can edit own zombie maps" on public.zombie_maps for update to authenticated
 using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "Owner can delete own zombie maps" on public.zombie_maps for delete to authenticated using(owner_id=auth.uid());
grant select on public.zombie_maps to anon, authenticated;
grant insert, update, delete on public.zombie_maps to authenticated;

create or replace function public.zr_validate_map() returns trigger
language plpgsql set search_path='' as $$
declare route jsonb; point jsonb;
begin
 if length(trim(new.name)) not between 1 and 100
 or not(new.center_lat between -90 and 90) or not(new.center_lon between -180 and 180)
 or new.radius_m not between 50 and 5000 or jsonb_typeof(new.routes)<>'array'
 then raise exception 'Invalid map'; end if;
 if jsonb_array_length(new.routes)>50 then raise exception 'Too many routes'; end if;
 for route in select value from jsonb_array_elements(new.routes) loop
  if jsonb_typeof(route)<>'array' then raise exception 'Invalid route'; end if;
  if jsonb_array_length(route) not between 2 and 1000 then raise exception 'Invalid route length'; end if;
  for point in select value from jsonb_array_elements(route) loop
   if jsonb_typeof(point->'lat') is distinct from 'number' or jsonb_typeof(point->'lon') is distinct from 'number'
    then raise exception 'Invalid coordinates'; end if;
   if not((point->>'lat')::double precision between -90 and 90)
    or not((point->>'lon')::double precision between -180 and 180) then raise exception 'Invalid coordinates'; end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.zr_validate_map() from public, anon, authenticated;
drop trigger if exists zr_validate_map on public.zombie_maps;
create trigger zr_validate_map before insert or update on public.zombie_maps for each row execute function public.zr_validate_map();

create table if not exists public.game_rooms (
 id uuid primary key default gen_random_uuid(), code text unique not null,
 host_name text, status text not null default 'waiting',
 config jsonb not null default '{}', created_at timestamptz not null default now(), started_at timestamptz
);
alter table public.game_rooms add column if not exists host_user_id uuid references auth.users(id) on delete set null;
create table if not exists public.room_players (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.game_rooms(id) on delete cascade,
 nickname text not null, distance_m double precision not null default 0, health integer,
 score integer not null default 0, status text not null default 'alive',
 joined_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.room_players add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists zr_room_member on public.room_players(room_id,auth_user_id) where auth_user_id is not null;
create index if not exists zr_room_players_room on public.room_players(room_id);
alter table public.game_rooms enable row level security;
alter table public.room_players enable row level security;
drop policy if exists "Anyone can read rooms" on public.game_rooms;
drop policy if exists "Anyone can create rooms" on public.game_rooms;
drop policy if exists "Anyone can update rooms" on public.game_rooms;
drop policy if exists "Anyone can read room players" on public.room_players;
drop policy if exists "Anyone can join rooms" on public.room_players;
drop policy if exists "Anyone can update room players" on public.room_players;
-- All room access goes through the identity-checked RPCs below.
revoke all on public.game_rooms, public.room_players from anon, authenticated;

create or replace function public.zr_create_room(p_nickname text,p_config jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.game_rooms; p public.room_players; v_config jsonb; v_code text; attempt integer;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_nickname is null or length(trim(p_nickname)) not between 1 and 20 then raise exception '닉네임은 1~20자예요.'; end if;
 if p_config is null or jsonb_typeof(p_config)<>'object' then raise exception 'Invalid room config'; end if;
 if coalesce(p_config->>'paceIdx','1') !~ '^[0-3]$' then raise exception 'Invalid pace'; end if;
 if p_config ? 'mapId' then
  if not exists(select 1 from public.zombie_maps where id=(p_config->>'mapId')::uuid) then raise exception '지도를 찾을 수 없어요.'; end if;
  v_config:=jsonb_build_object('paceIdx',coalesce(p_config->>'paceIdx','1')::int,'mapId',p_config->>'mapId');
 else
  if coalesce(p_config->>'radiusIdx','1') !~ '^[0-3]$'
    or coalesce(p_config->>'playMode','free') not in ('free','restricted') then raise exception 'Invalid room settings'; end if;
  v_config:=jsonb_build_object('paceIdx',coalesce(p_config->>'paceIdx','1')::int,
   'radiusIdx',coalesce(p_config->>'radiusIdx','1')::int,'playMode',coalesce(p_config->>'playMode','free'));
 end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if (select count(*) from public.game_rooms where host_user_id=auth.uid() and created_at>now()-interval '24 hours' and status<>'closed')>=5
 then raise exception '열려 있는 방을 먼저 닫아주세요.'; end if;
 for attempt in 1..5 loop
  v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  begin
   insert into public.game_rooms(code,host_name,host_user_id,config) values(v_code,trim(p_nickname),auth.uid(),v_config) returning * into r;
   exit;
  exception when unique_violation then
   if attempt=5 then raise; end if;
  end;
 end loop;
 insert into public.room_players(room_id,nickname,auth_user_id,health)
 values(r.id,trim(p_nickname),auth.uid(),6) returning * into p;
 return jsonb_build_object('room',to_jsonb(r)-'host_user_id','player',to_jsonb(p)-'auth_user_id');
end $$;

create or replace function public.zr_join_room(p_code text,p_nickname text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.game_rooms; p public.room_players;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_nickname is null or length(trim(p_nickname)) not between 1 and 20 then raise exception '닉네임은 1~20자예요.'; end if;
 select * into r from public.game_rooms where code=upper(trim(p_code)) and created_at>now()-interval '24 hours' for update;
 if r.id is null or r.status<>'waiting' then raise exception '참가할 수 있는 방을 찾지 못했어요.'; end if;
 select * into p from public.room_players where room_id=r.id and auth_user_id=auth.uid();
 if p.id is null then
  if (select count(*) from public.room_players where room_id=r.id)>=50 then raise exception '방이 가득 찼어요.'; end if;
  insert into public.room_players(room_id,nickname,auth_user_id,health) values(r.id,trim(p_nickname),auth.uid(),6) returning * into p;
 end if;
 return jsonb_build_object('room',to_jsonb(r)-'host_user_id','player',to_jsonb(p)-'auth_user_id');
end $$;

create or replace function public.zr_read_room(p_room uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.game_rooms; v_players jsonb;
begin
 if not exists(select 1 from public.room_players where room_id=p_room and auth_user_id=auth.uid()) then raise exception '방 참가 권한이 없어요.'; end if;
 select * into r from public.game_rooms where id=p_room and created_at>now()-interval '24 hours';
 if r.id is null then raise exception '방이 만료됐어요.'; end if;
 select coalesce(jsonb_agg(to_jsonb(p)-'auth_user_id' order by joined_at),'[]') into v_players from public.room_players p where room_id=p_room;
 return jsonb_build_object('room',to_jsonb(r)-'host_user_id','players',v_players);
end $$;

create or replace function public.zr_start_room(p_room uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.game_rooms;
begin
 select * into r from public.game_rooms where id=p_room and host_user_id=auth.uid() and created_at>now()-interval '24 hours' for update;
 if r.id is null or r.status not in ('waiting','started') then raise exception '방장만 대기 중인 방을 시작할 수 있어요.'; end if;
 if r.status='waiting' then
  update public.game_rooms set status='started',started_at=now() where id=p_room returning * into r;
 end if;
 return to_jsonb(r)-'host_user_id';
end $$;

create or replace function public.zr_leave_room(p_room uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.game_rooms;
begin
 select * into r from public.game_rooms where id=p_room for update;
 if not exists(select 1 from public.room_players where room_id=p_room and auth_user_id=auth.uid()) then return; end if;
 if r.status='waiting' then
  if r.host_user_id=auth.uid() then update public.game_rooms set status='closed' where id=p_room; end if;
  delete from public.room_players where room_id=p_room and auth_user_id=auth.uid();
 else
  update public.room_players set status='finished',updated_at=now() where room_id=p_room and auth_user_id=auth.uid() and status='alive';
 end if;
end $$;

create or replace function public.zr_update_stat(p_room uuid,p_distance double precision,p_health integer,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.game_rooms;
begin
 if p_distance is null or not(p_distance between 0 and 1000000)
 or p_health is null or p_health not between 0 and 6 or p_status is null or p_status not in ('alive','caught','finished') then raise exception 'Invalid player status'; end if;
 select * into r from public.game_rooms where id=p_room and status='started' and created_at>now()-interval '24 hours' for update;
 if r.id is null then raise exception '진행 중인 방이 아니에요.'; end if;
 if not exists(select 1 from public.room_players where room_id=p_room and auth_user_id=auth.uid()) then raise exception '방 참가 권한이 없어요.'; end if;
 update public.room_players set distance_m=greatest(distance_m,least(p_distance,extract(epoch from (now()-r.started_at))*10)),
  health=least(coalesce(health,6),p_health),status=p_status,updated_at=now()
 where room_id=p_room and auth_user_id=auth.uid() and status='alive';
end $$;

revoke all on function public.zr_create_room(text,jsonb),public.zr_join_room(text,text),
 public.zr_read_room(uuid),public.zr_start_room(uuid),public.zr_leave_room(uuid),
 public.zr_update_stat(uuid,double precision,integer,text) from public, anon;
grant execute on function public.zr_create_room(text,jsonb),public.zr_join_room(text,text),
 public.zr_read_room(uuid),public.zr_start_room(uuid),public.zr_leave_room(uuid),
 public.zr_update_stat(uuid,double precision,integer,text) to authenticated;

-- The public auth Edge Function calls this with its service-role client only.
create schema if not exists zr_private;
revoke all on schema zr_private from public, anon, authenticated;
create table if not exists zr_private.auth_limits (
 key text primary key, bucket timestamptz not null, hits integer not null
);
create or replace function public.zr_auth_limit(p_key text,p_limit integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_hits integer; v_bucket timestamptz:=date_trunc('minute',now());
begin
 if length(p_key)<>64 or p_limit not between 1 and 100 then raise exception 'Invalid limit'; end if;
 delete from zr_private.auth_limits where bucket<now()-interval '1 day';
 insert into zr_private.auth_limits(key,bucket,hits) values(p_key,v_bucket,1)
 on conflict(key) do update set bucket=v_bucket,
 hits=case when zr_private.auth_limits.bucket=v_bucket then zr_private.auth_limits.hits+1 else 1 end
 returning hits into v_hits;
 return v_hits<=p_limit;
end $$;
revoke all on function public.zr_auth_limit(text,integer) from public, anon, authenticated;
grant execute on function public.zr_auth_limit(text,integer) to service_role;

notify pgrst, 'reload schema';
commit;

-- Close expired rooms without deleting participant records.
begin;
create or replace function public.zr_expire_rooms()
returns integer language plpgsql security definer set search_path = public
as $$
declare affected integer;
begin
  update public.game_rooms set status = 'closed'
  where status <> 'closed' and created_at <= now() - interval '24 hours';
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.zr_expire_rooms() from public, anon, authenticated;
grant execute on function public.zr_expire_rooms() to service_role;

create or replace function public.zr_expire_rooms_on_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.zr_expire_rooms();
  return new;
end;
$$;
revoke all on function public.zr_expire_rooms_on_insert() from public, anon, authenticated;
drop trigger if exists zr_expire_rooms_on_insert on public.game_rooms;
create trigger zr_expire_rooms_on_insert before insert on public.game_rooms
for each statement execute function public.zr_expire_rooms_on_insert();
commit;

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

begin;

alter table public.zombie_maps add column if not exists boundary jsonb;

create or replace function public.zr_validate_boundary() returns trigger
language plpgsql set search_path='' as $$
declare point jsonb;
begin
 if new.boundary is null then return new; end if;
 if jsonb_typeof(new.boundary) <> 'array' then raise exception 'Invalid boundary'; end if;
 if jsonb_array_length(new.boundary) not between 3 and 200 then raise exception 'Invalid boundary length'; end if;
 for point in select value from jsonb_array_elements(new.boundary) loop
  if jsonb_typeof(point->'lat') is distinct from 'number' or jsonb_typeof(point->'lon') is distinct from 'number'
   then raise exception 'Invalid boundary coordinates'; end if;
  if not((point->>'lat')::double precision between -90 and 90)
   or not((point->>'lon')::double precision between -180 and 180) then raise exception 'Invalid boundary coordinates'; end if;
 end loop;
 return new;
end $$;
revoke all on function public.zr_validate_boundary() from public, anon, authenticated;
drop trigger if exists zr_validate_boundary on public.zombie_maps;
create trigger zr_validate_boundary before insert or update on public.zombie_maps
 for each row execute function public.zr_validate_boundary();

notify pgrst, 'reload schema';
commit;

-- Room-scoped survival rankings, preserving identity checks and terminal records.
begin;
alter table public.room_players add column if not exists elapsed_sec integer not null default 0
 check (elapsed_sec between 0 and 86400);

create or replace function public.zr_update_stat_v2(p_room uuid,p_distance double precision,p_health integer,p_status text,p_elapsed integer)
returns void language plpgsql security definer set search_path='' as $$
declare r public.game_rooms; max_elapsed integer;
begin
 if p_distance is null or not(p_distance between 0 and 1000000)
 or p_health is null or p_health not between 0 and 6
 or p_status is null or p_status not in ('alive','caught','finished')
 or p_elapsed is null or p_elapsed not between 0 and 86400 then raise exception 'Invalid player status'; end if;
 select * into r from public.game_rooms where id=p_room and status='started'
 and created_at>now()-interval '24 hours' for update;
 if r.id is null then raise exception '진행 중인 방이 아니에요.'; end if;
 if not exists(select 1 from public.room_players where room_id=p_room and auth_user_id=auth.uid())
 then raise exception '방 참가 권한이 없어요.'; end if;
 max_elapsed:=greatest(0,floor(extract(epoch from (now()-r.started_at)))::integer);
 update public.room_players set
  elapsed_sec=greatest(elapsed_sec,least(p_elapsed,max_elapsed)),
  distance_m=greatest(distance_m,least(p_distance,max_elapsed*10)),
  health=least(coalesce(health,6),p_health),status=p_status,updated_at=now()
 where room_id=p_room and auth_user_id=auth.uid() and status='alive';
end $$;
revoke all on function public.zr_update_stat_v2(uuid,double precision,integer,text,integer) from public,anon;
grant execute on function public.zr_update_stat_v2(uuid,double precision,integer,text,integer) to authenticated;
notify pgrst, 'reload schema';
commit;

-- Personal runner identity is separate from room codes and administrator accounts.
begin;
create table if not exists zr_private.runners (
 id uuid primary key default gen_random_uuid(), nickname text not null,
 nickname_key text unique not null, code_hash bytea not null,
 created_at timestamptz not null default now()
);
create table if not exists zr_private.runner_sessions (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 runner_id uuid not null references zr_private.runners(id)
);
create table if not exists zr_private.runner_attempts (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 bucket timestamptz not null, hits integer not null
);
create table if not exists zr_private.solo_runs (
 id uuid primary key, runner_id uuid not null references zr_private.runners(id),
 mode text not null check(mode in ('free','restricted')), pace integer not null check(pace between 0 and 3),
 radius integer not null check(radius between 0 and 3),
 elapsed_sec integer not null default 0, distance_m integer not null default 0,
 status text not null default 'alive', started_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), finished_at timestamptz,
 previous_sec integer, is_best boolean not null default false
);
create index if not exists zr_solo_rank on zr_private.solo_runs(mode,pace,radius,runner_id,elapsed_sec desc,distance_m desc) where finished_at is not null;
revoke all on zr_private.runners,zr_private.runner_sessions,zr_private.runner_attempts,zr_private.solo_runs from public,anon,authenticated;

create or replace function public.zr_runner_connect(p_nickname text,p_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_name text:=regexp_replace(trim(p_nickname),'\s+',' ','g'); v_code text;
 r zr_private.runners; v_hits integer;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if v_name is null or length(v_name) not between 1 and 20 then raise exception '닉네임은 1~20자로 입력해주세요.'; end if;
 insert into zr_private.runner_attempts values(auth.uid(),date_trunc('hour',now()),1)
 on conflict(auth_user_id) do update set bucket=date_trunc('hour',now()),
 hits=case when runner_attempts.bucket=date_trunc('hour',now()) then runner_attempts.hits+1 else 1 end
 returning hits into v_hits;
 if v_hits>30 then return jsonb_build_object('error','접속 시도가 많아요. 잠시 후 다시 시도해주세요.'); end if;
 if p_code is null then
  v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,20));
  insert into zr_private.runners(nickname,nickname_key,code_hash)
  values(v_name,lower(v_name),sha256(convert_to(v_code,'UTF8')))
  on conflict(nickname_key) do nothing returning * into r;
  if r.id is null then return jsonb_build_object('error','이미 사용 중인 닉네임이에요. 개인 코드로 접속하거나 다른 닉네임을 골라주세요.'); end if;
 else
  select * into r from zr_private.runners where nickname_key=lower(v_name)
   and code_hash=sha256(convert_to(upper(regexp_replace(p_code,'[\s-]','','g')),'UTF8'));
  if r.id is null then return jsonb_build_object('error','닉네임과 개인 코드를 확인해주세요.'); end if;
 end if;
 insert into zr_private.runner_sessions values(auth.uid(),r.id)
 on conflict(auth_user_id) do update set runner_id=excluded.runner_id;
 return jsonb_build_object('runner',jsonb_build_object('id',r.id,'nickname',r.nickname),'code',v_code);
end $$;

create or replace function public.zr_runner_me() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'nickname',r.nickname) from zr_private.runners r
 join zr_private.runner_sessions s on s.runner_id=r.id where s.auth_user_id=auth.uid();
$$;
create or replace function public.zr_runner_disconnect() returns void
language sql security definer set search_path='' as $$
 delete from zr_private.runner_sessions where auth_user_id=auth.uid();
$$;

create or replace function public.zr_solo_start(p_id uuid,p_mode text,p_pace integer,p_radius integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_runner uuid; r zr_private.solo_runs;
begin
 select runner_id into v_runner from zr_private.runner_sessions where auth_user_id=auth.uid();
 if v_runner is null then raise exception '닉네임과 개인 코드로 먼저 접속해주세요.'; end if;
 if p_id is null or p_mode is null or p_mode not in ('free','restricted') or p_pace is null or p_pace not between 0 and 3
 or p_radius is null or p_radius not between 0 and 3 then raise exception 'Invalid run settings'; end if;
 perform pg_advisory_xact_lock(hashtext(v_runner::text));
 select * into r from zr_private.solo_runs where id=p_id;
 if r.id is not null then
  if r.runner_id<>v_runner then raise exception 'Invalid run'; end if;
  return to_jsonb(r)-'runner_id';
 end if;
 if exists(select 1 from zr_private.solo_runs where runner_id=v_runner and status='alive' and updated_at>now()-interval '30 seconds')
 then raise exception '다른 러닝이 진행 중이에요. 종료하거나 30초 후 다시 시도해주세요.'; end if;
 insert into zr_private.solo_runs(id,runner_id,mode,pace,radius)
 values(p_id,v_runner,p_mode,p_pace,case when p_mode='free' then 0 else p_radius end) returning * into r;
 return to_jsonb(r)-'runner_id';
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
 return to_jsonb(r)-'runner_id';
end $$;

create or replace function public.zr_solo_board(p_mode text,p_pace integer,p_radius integer)
returns jsonb language sql security definer set search_path='' as $$
 with me as (select runner_id from zr_private.runner_sessions where auth_user_id=auth.uid()),
 best as (
  select distinct on (s.runner_id) s.runner_id,s.elapsed_sec,s.distance_m
  from zr_private.solo_runs s where s.finished_at is not null and s.mode=p_mode and s.pace=p_pace
  and s.radius=case when p_mode='free' then 0 else p_radius end
  order by s.runner_id,s.elapsed_sec desc,s.distance_m desc,s.finished_at
 ), ranked as (
  select b.runner_id id,r.nickname,b.elapsed_sec,b.distance_m,
   rank() over(order by b.elapsed_sec desc,b.distance_m desc) rank
  from best b join zr_private.runners r on r.id=b.runner_id
 ), top_players as (select * from ranked order by rank,nickname,id limit 50)
 select jsonb_build_object(
  'players',(select coalesce(jsonb_agg(to_jsonb(t) order by rank,nickname,id),'[]') from top_players t),
  'me',(select to_jsonb(t) from ranked t where id=(select runner_id from me)),
  'total',(select count(*) from ranked),
  'recent',(select coalesce(jsonb_agg(to_jsonb(t) order by finished_at desc),'[]') from (
    select id,elapsed_sec,distance_m,finished_at from zr_private.solo_runs
    where runner_id=(select runner_id from me) and finished_at is not null and mode=p_mode and pace=p_pace
    and radius=case when p_mode='free' then 0 else p_radius end order by finished_at desc limit 5) t)
 );
$$;
revoke all on function public.zr_runner_connect(text,text),public.zr_runner_me(),public.zr_runner_disconnect(),
 public.zr_solo_start(uuid,text,integer,integer),public.zr_solo_update(uuid,integer,double precision,text),
 public.zr_solo_board(text,integer,integer) from public,anon;
grant execute on function public.zr_runner_connect(text,text),public.zr_runner_me(),public.zr_runner_disconnect(),
 public.zr_solo_start(uuid,text,integer,integer),public.zr_solo_update(uuid,integer,double precision,text),
 public.zr_solo_board(text,integer,integer) to authenticated;
notify pgrst,'reload schema';
alter table zr_private.runners enable row level security;
alter table zr_private.runner_sessions enable row level security;
alter table zr_private.runner_attempts enable row level security;
alter table zr_private.solo_runs enable row level security;
commit;

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
