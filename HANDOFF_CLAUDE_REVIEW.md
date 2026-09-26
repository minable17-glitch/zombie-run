# Claude 인계 검토 — 좀비런

작성일: 2026-09-26. 기준 커밋 `f896aef`. 원본 인계 문서 `HANDOFF.md`(`6242484`)와 이전 담당자의 보충 답변 `HANDOFF_SUPPLEMENT.md`(`f896aef`)는 원문 그대로 두고, 이 문서에는 두 문서를 Claude가 코드로 대조한 결과와 이어서 작업할 규칙을 적는다. `DEPLOYMENT.md`도 역사 기록으로 수정하지 않는다. 비밀 값은 적지 않는다. **“모름”은 미적용·변경 없음이라는 뜻이 아니다.**

## 0. 이어서 작업할 때 지킬 것 (현재 상태 보존)

- `main`에 push하면 GitHub Pages로 바로 공개 배포된다. 작업은 별도 브랜치에서 하고, 사용자 확인 후에만 `main`에 반영한다.
- Supabase 프로젝트는 **새싹책방(실제 학급 운영 중)과 공유**한다. 좀비런 SQL은 `zr_*` 객체와 공용 `public.profiles`만 다루도록 설계됐지만, 공유 프로젝트를 건드린 이력이 있으므로 새싹책방 영향이 없다고 단정하지 말 것.
- 운영 DB에는 읽기 전용 확인 쿼리부터 실행하고, 변경 SQL은 결과를 보고 필요한 파일만 적용한다. 빈 마이그레이션 장부를 근거로 전체를 재실행하지 말 것.
- 운영 데이터 정리 금지: 검증용 데이터를 실제 사용자 데이터와 구분할 확정 규칙이 없다. 운영 UI에서 본 맵 `학의천`, `아침러닝`, `Ddd`도 검증용인지 모른다.
- 기준선(2026-09-26, 클라우드 환경에서 재확인): `npm ci` → `npm test -- --maxWorkers=2` 97개 통과, `npm run build` 성공.

## 1. 이전 담당자 컴퓨터에만 있던 것

- 저장소: `main`이 `origin/main`과 같고 로컬 전용 커밋·stash·미추적 파일 없음. Git 밖에는 `.env.local`, `dist/`, `node_modules/`만 있음.
- 저장소 밖 자료(Git에 없음, 사용자 컴퓨터에만 있음):
  - 초기 인계 메모 `C:\Users\user\Desktop\zombierunhandoff.md` — 내용·비밀 값 포함 여부 미확인.
  - 방 재생성 오류 스크린샷 `C:\Users\user\AppData\Local\Temp\codex-clipboard-9e5bdd90-….png` — 임시 폴더라 사라질 수 있음. 사용자 화면이므로 공개 저장소에 올리지 말 것.
  - Break A Leg UI 참고 이미지 — 임시 파일은 삭제됨. 다른 복사본 위치 모름. 필요하면 사용자에게 다시 요청.

## 2. 운영 DB 상태

### 미확인 마이그레이션 3개 — 확인 방법

| 파일 | 대응 커밋 | 프런트 의존 |
| --- | --- | --- |
| `20260911030000_legacy_profile_lookup.sql` | `abc2c5c` | `src/lib/authHelpers.js`가 `zr_ensure_profile` 호출 |
| `20260922020000_finished_rooms.sql` | `70cfeb9` | `src/lib/roomApi.js`가 방 생성 전 `zr_cleanup_finished_rooms` 호출 — 미적용이면 방 생성 흐름에서 오류 가능 |
| `20260923010000_solo_maps.sql` | `582563b` | `src/lib/runnerApi.js`가 `zr_solo_start`에 `map:<id>` 모드 전달 — 미적용이면 저장 맵 혼자 달리기 시작 실패 가능 |

- Claude 대조 결과: 세 파일의 함수·제약은 **이후 마이그레이션에서 다시 정의되지 않는다.** 따라서 각 파일 내용이 최신 정의이고, 세 파일 모두 `create or replace`/`drop constraint if exists` 형태라 같은 내용을 다시 적용해도 이후 변경을 되돌리지 않는다. 그래도 먼저 확인하고 필요한 것만 적용한다.
- 확인 쿼리: `supabase/checks/unconfirmed_migrations_check.sql` (SELECT만 있음, 데이터·정의 변경 없음). SQL Editor에서 실행해 모든 행이 `true`면 적용 완료. `false`가 나온 행의 파일만 검토 후 적용한다.
- 쿼리 검증: 로컬 PGlite에서 전체 마이그레이션 적용 시 6행 모두 `true`, 세 파일을 하나씩 빼면 해당 파일 행만 `false`가 되는 것을 확인했다. 운영에서는 아직 실행하지 않았다.

### migrations 폴더 밖 SQL

- 전체 목록은 모름. 특정된 것만:
  - `supabase/maintenance.sql`: pg_cron 활성화 후 Cron `zr-expire-rooms`(`*/15 * * * *`) 등록. 만료 방을 닫는 작업이며 참가자 기록은 지우지 않는다. 9/11 등록 확인, 현재 활성 상태·최근 실행 결과는 모름.
  - 9/23 운영 함수 정의를 읽는 확인용 SELECT(6자리 생성·시도 제한 모두 `true`). 읽기 전용.
- 새싹책방 전용 객체를 직접 수정했는지: 모름. 공유 Auth와 `profiles` 관련 함수·트리거는 수정했다(다른 앱의 username 없는 계정과 익명 계정은 프로필 생성 대상에서 제외하도록 설계).

## 3. Supabase 설정

| 항목 | 알려진 사실 | 모름 |
| --- | --- | --- |
| 익명 로그인 | 9/11 운영 활성화 확인 | 변경 전 값, 변경 시점 |
| Auth Redirect URL | `DEPLOYMENT.md`에 등록 지침 있음, 실제 이메일 복구 성공 기록 있음 | 실제 등록 목록 전체와 이전 목록 (지침을 실행 증거로 보지 말 것) |
| 전역 Site URL | 공유 프로젝트라 덮어쓰지 말라는 지침 | 실제 값, 변경 여부 |
| 이메일 템플릿 / SMTP | 운영 메일 수신 기록 있음 | 수정 여부, 이전 값 |
| `zombie-auth` | 저장소 설정 `verify_jwt = false`. 함수 소스의 마지막 변경 커밋은 `699557c`(Claude가 git 이력으로 재확인). 9/11 v1 ACTIVE, 잘못된 로그인 401 확인 | 운영 배포본이 `699557c`와 같은지(해시 대조 안 함) |
| Edge Function secret | 소스가 참조: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, 선택 `ZR_ALLOWED_REDIRECTS` | 실제 설정된 이름 목록 |

## 4. 사용자 제보 4건 — 수정 커밋과 회귀 테스트

아래 커밋과 테스트 이름은 Claude가 저장소에서 모두 존재함을 확인했다. 실기기 재검증은 네 건 모두 안 됐다.

| 제보 | 수정 커밋 | 테스트 |
| --- | --- | --- |
| 종료 후 다시 방 만들기 오류 | `70cfeb9` | `tests/database.test.js` — completed rooms can be closed by their owner… (SQL 수준. 운영 SQL 적용은 §2에서 확인 필요) |
| 자유 모드에 기존 맵 경로 적용 | `b4f6c6c` | `tests/App.test.jsx` — free mode inside a saved map ignores its routes…; `tests/RoomLobby.test.jsx` — authored map selection is explicit…; `tests/gameEngine.test.js` — a selected map keeps zombies on the authored route… |
| 두 번째 깃발/원 클릭 시 검은 화면 | `a370804` | `tests/AdminRouteEditor.test.jsx` — second circle click and repeated flag clicks keep a finite radius |
| 이메일 복구 문제 | `699557c`, `a74d5af`, `abc2c5c`, `9c065dc`, `c4f8fbf`, 테스트 추가 `bc93b64` | `auth-handler.test.js`, `accountLanding.test.jsx`, `database.test.js`(legacy profiles…), `AuthScreen.test.jsx`, `recoveryExpired.test.jsx`, `ResetPassword.test.jsx` |

비밀번호 재설정의 최종 제출은 사용자가 직접 할 단계로 남아 있다.

## 5. 기타

- 로컬 전체 병렬 실행 때 5초를 넘긴 테스트 3개 (원인 미확정, 타임아웃을 늘려 숨기지 말 것):
  1. `tests/App.test.jsx` — double start only creates one GPS request and game loop…
  2. `tests/AppRanking.test.jsx` — room ranking and final record work in free/map mode (map: false)
  3. `tests/RunDisplay.test.jsx` — PIP uses an explicit tap…
- `DEPLOYMENT.md`에서 현재와 다른 부분:
  - 진동 단계: 문서의 2단계(70m/8초, 25m/3초)는 과거 값. 현재는 70/50/30/15m에서 8/4/2/1초 4단계(`src/lib/proximityAlert.js`에서 확인).
  - `반영 순서`: `schema.sql`이 초기 두 파일만 합쳤다는 설명은 틀림. 최신 DB는 마이그레이션 10개 전체 기준.
  - 날짜별 테스트 수(31/33/79)는 당시 기록. `운영 확인` 끝 항목은 체크리스트이며 전부 실행 성공 기록이 아님.
- 설치형 앱: 프레임워크(Capacitor/React Native/Flutter 등)는 **미정**. 설명한 방향은 “웹앱 최대 재사용 + 백그라운드 위치·게임 진행 별도 구현 + Android 먼저, iPhone 다음”. 사용자는 대상 기종으로 “둘 다”라고 답했고, Android 우선 순서나 특정 기술에 명시 동의한 기록은 없다. Play 등록은 질문·설명 단계.

## 6. 아직 안 된 것

1. 화면을 완전히 끄거나 다른 앱을 쓰는 동안 GPS·좀비 추격·기록이 계속되는 기능(Android·iPhone).
2. 실제 휴대폰에서 PIP 창 표시 확인.
3. 설치형 앱 생성·서명·설치·현장 검증.
4. 실기기 GPS·진동·다중 기기 러닝, 제보 4건의 실기기 회귀 확인.
5. §2 미확인 SQL 3개와 §3 운영 설정의 현재 상태 대조.
