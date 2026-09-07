-- Supabase 프로젝트의 SQL Editor에서 이 파일 내용을 실행하세요. 여러 번 실행해도 안전합니다
-- (이미 있는 건 건너뛰거나 정책을 다시 만듭니다).
--
-- zombie_maps는 누구나 계정을 만들어 로그인하면 자기 것을 만들 수 있습니다. 읽기(select)는
-- 로그인 없이도 누구나 가능(게임에서 다른 사람이 만든 지도로 플레이해야 하니까)하지만,
-- 쓰기(insert)는 로그인한 사람만, 수정/삭제(update/delete)는 그 지도를 만든 본인만 가능합니다
-- (owner_id로 소유자를 구분). 계정 가입은 앱 안의 "내 좀비 경로 만들기" → "계정 만들기"에서
-- 바로 할 수 있습니다. game_rooms/room_players는 로그인 없이 누구나 방을 만들고 참가하는
-- 기능이라 그대로 열어뒀습니다.

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
