-- 읽기 전용 확인 쿼리: 데이터·함수·권한을 바꾸지 않는다.
-- 대상: 운영 반영이 확인되지 않은 마이그레이션 3개
--   20260911030000_legacy_profile_lookup.sql
--   20260922020000_finished_rooms.sql
--   20260923010000_solo_maps.sql
-- 세 파일의 함수/제약은 이후 마이그레이션에서 다시 정의되지 않으므로, 각 파일 내용이 최신 정의다.
-- 모든 행이 true면 해당 파일은 이미 반영된 상태다. false가 나온 행의 파일만 검토 후 적용한다.
select check_name, ok from (values
 ('legacy_profile_lookup: zr_ensure_profile가 기존 프로필을 먼저 사용',
  coalesce((select pg_get_functiondef(p) like '%if found then return; end if;%'
            from to_regprocedure('public.zr_ensure_profile()') p where p is not null), false)),
 ('finished_rooms: zr_cleanup_finished_rooms 함수 존재',
  to_regprocedure('public.zr_cleanup_finished_rooms()') is not null),
 ('finished_rooms: 로그인 사용자 실행 권한',
  coalesce((select has_function_privilege('authenticated', p, 'execute')
            from to_regprocedure('public.zr_cleanup_finished_rooms()') p where p is not null), false)),
 ('finished_rooms: 비로그인(anon) 실행 권한 없음',
  coalesce((select not has_function_privilege('anon', p, 'execute')
            from to_regprocedure('public.zr_cleanup_finished_rooms()') p where p is not null), false)),
 ('solo_maps: solo_runs 모드 제약이 map:<id> 허용',
  exists(select 1 from pg_constraint c
         where c.conname = 'solo_runs_mode_check'
           and c.conrelid = to_regclass('zr_private.solo_runs')
           and pg_get_constraintdef(c.oid) like '%map:%')),
 ('solo_maps: zr_solo_start가 저장 맵 존재를 검사',
  coalesce((select pg_get_functiondef(p) like '%public.zombie_maps%'
            from to_regprocedure('public.zr_solo_start(uuid,text,integer,integer)') p where p is not null), false))
) as t(check_name, ok);
