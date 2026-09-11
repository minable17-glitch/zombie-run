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
