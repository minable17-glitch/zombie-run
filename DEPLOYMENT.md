# 좀비런 보안 수정 배포

## 현재 상태 — 2026-09-10

- 로컬 앱 수정과 실행 가능한 DB 마이그레이션을 준비했습니다.
- DB 테스트는 PGlite PostgreSQL에서 실제 SQL, 트리거, 역할별 접근 권한을 실행합니다.
  Supabase Auth 게이트웨이와 이메일 발송까지 검증하는 테스트는 아닙니다.
- 운영 DB에는 아직 적용하지 않았습니다. Supabase OAuth 재인증 후
  `transaction_read_only = off` 및 마이그레이션·함수 배포 도구 활성화를 확인했습니다.
  자동 권한 요청의 `Invalid scope` 오류는 지원되는 권한을 명시해 해결했습니다.
- `zombie-auth` 함수 버전 1은 운영에 배포되어 ACTIVE 상태입니다.
  DB 전환과 프런트엔드 배포는 아직 적용하지 않았습니다.
- 운영 Auth 공개 설정에서 익명 로그인 활성화를 확인했습니다.
- GitHub 앱 연결은 사용자 저장소 push 권한을 표시하지만 실제 트리 생성은
  `403 Resource not accessible by integration`으로 거절됩니다.
  공식 GitHub CLI 기기 로그인을 시작했으며 사용자 인증을 기다립니다.

## 배포 단위와 영향

대상 프로젝트는 `ikljkokebcqaxpctcjpy`입니다. 이 프로젝트는 다른 앱과 Auth를 공유합니다.
이 변경은 `profiles`, `zombie_maps`, `game_rooms`, `room_players`, `zr_*` 함수 및
`zr_private` 스키마를 다룹니다. 기존 좀비런 프로필 트리거가 확인되는 경우에만 교체합니다.
아이디 메타데이터가 없는 다른 앱 계정과 익명 계정은 새 프로필 생성 대상에서 제외합니다.

기존 방에는 참가자 소유자 정보가 없어 새 권한 체계로 이어서 참가할 수 없습니다.
배포 이후에는 새 방을 만들어야 하며, 기존 방 데이터를 삭제하지는 않습니다.
프로필 조회 권한을 닫는 순간 기존 프런트엔드의 아이디 로그인은 동작하지 않습니다.
기존 실행 중인 그룹 세션도 새 권한 정책의 영향을 받으므로, 활성 세션이 없는 유지보수 시간에
백엔드와 프런트엔드를 함께 전환합니다.

## 반영 순서

1. GitHub와 Supabase 운영자 계정으로 로그인하고 위 프로젝트가 맞는지 확인합니다.
   비밀 키나 액세스 토큰을 소스 코드, `VITE_` 환경 변수 또는 채팅에 넣지 않습니다.
2. `npm ci`, `npm test`, `npm run build`를 실행합니다. 배포 대상 커밋과 현재 DB 정책을
   복구용으로 보관합니다. 공개 권한을 다시 여는 방식의 자동 롤백은 제공하지 않습니다.
3. Supabase에 `supabase/functions/zombie-auth/`의 함수를 배포합니다.
   `supabase/config.toml`의 함수 설정을 사용합니다. 함수는 로그인 이전 요청을 받으므로
   JWT 사전 검증을 끄고, 내부에서 비밀번호 검증과 요청 제한을 수행합니다.
   서버의 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`가 필요합니다.
4. 운영 프로젝트 SQL Editor에서
   `supabase/migrations/20260909140000_zombie_run_security.sql`,
   `supabase/migrations/20260910010000_room_expiration.sql`을 순서대로 실행합니다.
   각 파일은 트랜잭션이며, 오류가 있으면 해당 파일 적용을 중단합니다.
   `schema.sql`은 두 파일을 합친 내용이므로 대신 사용할 수 있습니다.
   Supabase Cron(pg_cron)을 활성화하고 `supabase/maintenance.sql`을 실행하면
   15분마다 생성 후 24시간 지난 방을 닫습니다. 참가자 기록은 삭제하지 않습니다.
   Cron이 없어도 새 방을 만들 때 만료된 방을 닫으며, 기존 API도 만료된 방 접근을 차단합니다.
5. Supabase Auth의 익명 로그인을 활성화합니다. 닉네임만 입력하는 참가자를 내부적으로
   구분하는 데 사용합니다. 로컬 `config.toml`은 운영 대시보드 설정을 자동 변경하지 않습니다.
6. Auth Redirect URLs에 아래 주소를 등록합니다. 공유 프로젝트의 기존 Site URL을
   좀비런 주소로 덮어쓰지 않습니다.

   - `https://minable17-glitch.github.io/zombie-run/`
   - `https://minable17-glitch.github.io/zombie-run/?account=1`
   - 로컬 개발이 필요한 경우 `https://localhost:5173/`와 같은 주소의 `?account=1` 버전

   함수의 `ZR_ALLOWED_REDIRECTS`는 쉼표로 구분한 기본 주소 목록입니다.
   기본값은 운영 주소와 로컬 주소입니다. 배포 주소를 변경하면 이 값도 변경합니다.
7. 위 단계가 성공한 뒤 프런트엔드를 배포합니다. 현재 GitHub Actions는 `main` 푸시 시
   테스트와 빌드를 거쳐 GitHub Pages에 배포합니다.

## 운영 확인

- 신규 가입 → 이메일 확인(활성화된 경우) → 로그아웃 → 아이디 재로그인.
- 아이디 찾기 이메일 링크로 접속했을 때 계정 화면에 본인 아이디 표시.
- 비밀번호 재설정 후 새 비밀번호로 로그인.
- 서로 다른 두 브라우저에서 방 생성·참가·시작 및 거리/체력 갱신.
- 방장이 아닌 사용자의 시작 요청과 타인 기록 수정 요청이 거절되는지 확인.
- 지도 생성·수정·삭제 후 게임 목록 반영 확인.
- 실제 휴대폰에서 GPS 권한 거부·복구, 화면 전환, 종료 후 추적 해제 확인.

로컬 테스트는 가상의 사용자와 좌표를 사용합니다. 운영 이메일 발송, 실제 GPS 주행 및
다중 기기 통신 검증을 대신하지 않습니다.
