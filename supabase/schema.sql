-- Supabase 프로젝트의 SQL Editor에서 이 파일 내용을 실행하세요. 여러 번 실행해도 안전합니다
-- (이미 있는 건 건너뛰거나 정책을 다시 만듭니다).
--
-- zombie_maps는 누구나 계정을 만들어 로그인하면 자기 것을 만들 수 있습니다. 읽기(select)는
-- 로그인 없이도 누구나 가능(게임에서 다른 사람이 만든 지도로 플레이해야 하니까)하지만,
-- 쓰기(insert)는 로그인한 사람만, 수정/삭제(update/delete)는 그 지도를 만든 본인만 가능합니다
-- (owner_id로 소유자를 구분). 계정 가입은 앱 안의 "내 좀비 경로 만들기" → "계정 만들기"에서
-- 바로 할 수 있습니다. game_rooms/room_players는 로그인 없이 누구나 방을 만들고 참가하는
-- 기능이라 그대로 열어뒀습니다.

-- ── 아이디(username) 로그인용 매핑 테이블 ──
-- Supabase Auth는 원래 이메일로 로그인하지만, 이 앱은 "아이디"로 로그인하게 하고
-- 싶어서 아이디→이메일 매핑을 여기 저장해둠. 로그인할 때 이 테이블에서 이메일을
-- 찾아서 그 이메일로 실제 로그인을 하고, 비밀번호를 잊어버렸을 때도 이 테이블에서
-- 이메일을 찾아 그 주소로 재설정 메일을 보냄. 회원가입하면 아래 트리거가 자동으로
-- 이 테이블에 한 줄을 채워줌(따로 코드로 만들 필요 없음).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 이미 대소문자가 섞인 채로 저장된 아이디가 있으면 소문자로 맞춰줌(폰 자동 대문자화 때문에
-- 가입 때와 로그인 때 입력이 서로 다른 문자열이 되어 로그인이 안 되던 문제의 재발 방지)
update public.profiles set username = lower(username) where username <> lower(username);

-- 로그인/비번찾기 화면에서 "아이디 → 이메일"을 찾아야 해서 로그인 없이도 읽을 수 있게 열어둠.
-- (아이디로 가입한 사람의 이메일이 남에게 노출될 수 있다는 뜻이라, 개인 프로젝트/학교용처럼
-- 신뢰할 수 있는 소규모 사용자만 쓰는 걸 전제로 함)
drop policy if exists "Anyone can look up username" on public.profiles;
create policy "Anyone can look up username" on public.profiles for select using (true);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, email)
  values (new.id, lower(new.raw_user_meta_data->>'username'), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 사용자가 만든 좀비 순찰 지도 ──
create table if not exists zombie_maps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  center_lat double precision not null,
  center_lon double precision not null,
  radius_m integer not null,
  routes jsonb not null,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 기존에 이 테이블을 만든 적이 있다면(owner_id 없이) 컬럼만 추가함
alter table zombie_maps add column if not exists owner_id uuid references auth.users(id) on delete set null;

alter table zombie_maps enable row level security;

drop policy if exists "Anyone can read zombie maps" on zombie_maps;
create policy "Anyone can read zombie maps" on zombie_maps for select using (true);

drop policy if exists "Anyone can add zombie maps" on zombie_maps;
drop policy if exists "Authenticated can add zombie maps" on zombie_maps;
create policy "Authenticated can add zombie maps" on zombie_maps
  for insert with check (auth.role() = 'authenticated' and owner_id = auth.uid());

drop policy if exists "Anyone can edit zombie maps" on zombie_maps;
drop policy if exists "Authenticated can edit zombie maps" on zombie_maps;
create policy "Owner can edit own zombie maps" on zombie_maps
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Anyone can delete zombie maps" on zombie_maps;
drop policy if exists "Authenticated can delete zombie maps" on zombie_maps;
create policy "Owner can delete own zombie maps" on zombie_maps
  for delete using (owner_id = auth.uid());

-- ── 그룹으로 같이 뛰기(방) ──
create table if not exists game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_name text,
  status text not null default 'waiting', -- waiting | started
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  started_at timestamptz
);

alter table game_rooms enable row level security;

drop policy if exists "Anyone can read rooms" on game_rooms;
create policy "Anyone can read rooms" on game_rooms for select using (true);

drop policy if exists "Anyone can create rooms" on game_rooms;
create policy "Anyone can create rooms" on game_rooms for insert with check (true);

drop policy if exists "Anyone can update rooms" on game_rooms;
create policy "Anyone can update rooms" on game_rooms for update using (true);

create table if not exists room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references game_rooms(id) on delete cascade,
  nickname text not null,
  distance_m double precision not null default 0,
  health integer,
  score integer not null default 0,
  status text not null default 'alive', -- alive | caught | finished
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table room_players enable row level security;

drop policy if exists "Anyone can read room players" on room_players;
create policy "Anyone can read room players" on room_players for select using (true);

drop policy if exists "Anyone can join rooms" on room_players;
create policy "Anyone can join rooms" on room_players for insert with check (true);

drop policy if exists "Anyone can update room players" on room_players;
create policy "Anyone can update room players" on room_players for update using (true);
