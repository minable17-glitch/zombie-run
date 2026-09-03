-- Supabase 프로젝트의 SQL Editor에서 이 파일 내용을 실행하세요. 여러 번 실행해도 안전합니다
-- (이미 있는 건 건너뛰거나 정책을 다시 만듭니다). 로그인/계정이 없는 개인 프로젝트라서
-- 누구나 읽고 쓸 수 있게 열어뒀어요 (관리자 화면 링크를 아는 사람만 접근한다는 전제).

-- ── 관리자가 만든 좀비 순찰 지도 ──
create table if not exists zombie_maps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  center_lat double precision not null,
  center_lon double precision not null,
  radius_m integer not null,
  routes jsonb not null,
  created_at timestamptz not null default now()
);

alter table zombie_maps enable row level security;

drop policy if exists "Anyone can read zombie maps" on zombie_maps;
create policy "Anyone can read zombie maps" on zombie_maps for select using (true);

drop policy if exists "Anyone can add zombie maps" on zombie_maps;
create policy "Anyone can add zombie maps" on zombie_maps for insert with check (true);

drop policy if exists "Anyone can edit zombie maps" on zombie_maps;
create policy "Anyone can edit zombie maps" on zombie_maps for update using (true);

drop policy if exists "Anyone can delete zombie maps" on zombie_maps;
create policy "Anyone can delete zombie maps" on zombie_maps for delete using (true);

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
