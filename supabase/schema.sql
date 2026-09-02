-- Supabase 프로젝트를 새로 만든 뒤, SQL Editor에서 이 파일 내용을 한 번 실행하세요.
-- 관리자가 만든 좀비 순찰 지도를 저장하는 테이블입니다. 로그인/계정이 없는 개인
-- 프로젝트라서 누구나 읽고 쓸 수 있게 열어뒀어요 (관리자 화면 링크를 아는 사람만
-- 접근한다는 전제).

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

create policy "Anyone can read zombie maps"
  on zombie_maps for select
  using (true);

create policy "Anyone can add zombie maps"
  on zombie_maps for insert
  with check (true);
