# HANDOFF 보충 답변

대상 인계 문서: `6242484`의 HANDOFF.md. 확인일 2026-09-26.
이번 확인은 Git 명령, 로컬 파일 존재 여부, 기존 작업 기록을 근거로 한다. Supabase 운영 대시보드/SQL History/서버 secret을 새로 조회하지 않았다. **모름은 미적용 또는 변경 없음이라는 뜻이 아니다.** 비밀 값은 기재하지 않는다.

## 1. 컴퓨터에만 있고 GitHub에 없는 것

`git fetch origin` 후 보충 문서 작성 전 결과:

### git status
```text
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```
### git stash list
출력 없음. stash 없음.
### git branch -a
```text
* main
  remotes/origin/HEAD -> origin/main
  remotes/origin/main
```
### git log origin/main..HEAD --oneline
출력 없음. 로컬 전용 커밋 없음.

- `git ls-files --others --exclude-standard`: 출력 없음. 미추적 소스/메모/시안 없음. 위 결과는 이 보충 문서를 쓰기 전의 스냅샷이다.
- Git 제외 로컬 파일: `.env.local`, `dist/` 빌드 결과, `node_modules/` 설치 의존성. 앞의 두 생성 폴더를 제외한 ignored 목록에서는 `.env.local`만 확인했다. 환경 값은 기재/커밋하지 않는다.
- 저장소의 이미지 검색 결과는 추적 중인 favicon SVG뿐이었다. Break A Leg 참고 이미지나 별도 시안 파일이 저장소 안에 있다는 근거는 없음.
- 저장소 밖 초기 인계 메모 `C:\Users\user\Desktop\zombierunhandoff.md`: 파일 존재 확인. 이번에 내용은 읽거나 Git에 복사하지 않았으므로 그 안의 비밀 값/현재 유효성은 모름.
- 사용자가 올린 Break A Leg 참고 이미지의 당시 경로 `C:\Users\user\AppData\Local\Temp\codex-clipboard-f155681d-88aa-42de-b487-c80beb5b091b.png`: 현재 파일 없음. 대화에는 이미지가 있었음. 다른 복사본 위치는 모름.
- 방 종료 후 다시 방 생성 오류 스크린샷 `C:\Users\user\AppData\Local\Temp\codex-clipboard-9e5bdd90-a537-4eb6-bd08-7f99f29b82a2.png`: 현재 존재 확인. Git에는 없음. 사용자 화면이므로 임의로 공개 저장소에 복사하지 않았음.
- 그 밖의 컴퓨터 전체 이미지·메모·시안은 검색하지 않았으므로 모름. 저장소가 깨끗하다는 것을 컴퓨터 전체에 인계 자료가 없다는 뜻으로 확대하지 말 것.

## 2. migrations 밖에서 실행한 SQL과 3개 미확인 항목

**수동 SQL 전체 목록: 모름.** 현재 확보한 실행/배포 기록으로 아래만 특정 가능하다. 임시 실행 후 파일에 남기지 않은 SQL이 전혀 없었다고 보증할 수 없다.

- 2026-09-11까지 적용 확인 기록: pg_cron 활성화 및 `zr-expire-rooms` 작업 등록. SQL은 migrations 밖의 `supabase/maintenance.sql`에 존재한다. 15분마다 만료 방을 닫는 작업이며 참가자 기록 삭제 작업이 아니다. pg_cron 활성화 때 사용한 정확한 SQL/클릭 경로는 모름.
- 2026-09-23 개인 코드 변경 작업에서 운영 함수 정의를 읽어 6자리 생성과 시도 제한의 존재를 검사하는 SELECT를 직접 실행했다. 마지막 결과는 두 항목 모두 true. 읽기 전용 검증 SQL이므로 마이그레이션에 들어 있지 않다.
- 같은 작업의 초기 함수 수정과 정규식 보완은 각각 six_digit_codes, code_attempt_guard 마이그레이션에 남아 있다. migrations 밖의 영구 수정으로 따로 누락된 것으로 확인된 것은 아니다.
- 그 밖의 migrations에 없는 임시 함수 수정, 권한 변경, 데이터 삭제/정리 SQL: 모름. 알려진 운영 검증용 계정과 기록은 보존한 것으로 기존 기록에 적혀 있으며, 이를 근거로 모든 시점의 삭제가 없었다고 단정하지 않는다.

### 확인 필요로 남긴 3개
- `legacy_profile_lookup`: 대응 Git 커밋은 `abc2c5c`(2026-09-11). 기존 계정의 username 메타데이터가 없어도 저장된 프로필을 사용하도록 수정한 파일이다. **이 SQL을 운영에서 실행한 성공/실패 화면이나 정확한 실행 시각은 모름.** 이후 실제 아이디 복구 성공 기록은 있으나, 그것만으로 해당 파일 전체 적용을 증명할 수 없다.
- `finished_rooms`: 대응 커밋은 `70cfeb9`(2026-09-22). **운영 SQL 실행 기록/성공·실패 화면은 모름.** 로컬 DB 테스트 및 프런트 배포 확인과 구분해야 한다.
- `solo_maps`: 대응 커밋은 `582563b`. **운영 SQL 실행 기록/성공·실패 화면은 모름.** 프런트의 저장 맵 목록 표시만으로 해당 SQL 적용 여부를 확정할 수 없다.
- 이전 담당자가 확인한 내용을 기억한다고 새로 꾸며서 추가할 수 없다. 운영 정의/제약을 직접 대조해야 한다.

### 새싹책방 영향
- “새싹책방 전용 테이블이나 함수를 직접 수정했는가”: **모름.** 전용 객체 변경을 특정하는 실행 기록은 없음.
- 공유 Supabase 프로젝트의 Auth와 profiles 관련 함수/트리거 및 좀비런 객체를 수정한 사실은 있음. 다른 앱의 username 없는 계정과 익명 계정을 프로필 생성에서 제외하도록 설계했다. 따라서 “공유 프로젝트를 전혀 건드리지 않았다”거나 “새싹책방에 영향이 절대 없다”고 말할 수는 없다.

## 3. Supabase 설정 변경

| 항목 | 확인 가능한 사실 | 변경 전 값 / 부족한 근거 |
| --- | --- | --- |
| 익명 로그인 | 9/11 배포 기록에서 운영 활성화 확인 | 이전 값 모름. 언제 어떤 UI로 전환했는지도 모름 |
| Auth Redirect URL | DEPLOYMENT.md에 운영 기본 주소와 account 화면, 로컬 개발 주소 등록 지침이 있음. 실제 이메일 복구 성공 기록도 있음 | 실제 추가된 목록 전체, 변경 시각, 이전 목록 모름. 지침을 실행 증거로 취급하지 말 것 |
| 전역 Site URL | 공유 프로젝트라 덮어쓰지 말라는 지침이 있음 | 실제 변경 유무 및 이전/현재 값 모름. 과거 localhost 이동 오류만으로 Site URL 값을 역추정할 수 없음 |
| 이메일 템플릿 | 실제 Supabase sign-in 메일 수신과 링크 사용 기록 있음 | 템플릿 수정 여부, 이전 내용 모름 |
| SMTP | 변경 기록을 특정하지 못함 | 변경 여부와 이전 값 모름 |
| zombie-auth JWT 설정 | 저장소 배포 설정은 verify_jwt=false이고 내부 인증을 처리하는 설계 | 운영 설정의 최신 재조회는 안 함. 실제 변경 전 값 모름 |

- `zombie-auth` 마지막 **운영 배포 소스 커밋: 모름.** 9/11 기록에 v1 ACTIVE와 잘못된 로그인 401 응답은 있음. 저장소에서 이 함수 소스를 바꾼 마지막 커밋은 `699557c`이고 그 뒤 함수 경로의 변경 커밋은 없다. 그러나 운영 함수 코드와 해시 대조를 안 했으므로 “운영도 확실히 699557c”라고 쓰지 않는다.
- **실제로 설정한 Edge Function secret 이름 전체: 모름.** 소스가 참조하는 이름은 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, 선택 항목 `ZR_ALLOWED_REDIRECTS`다. 참조 목록과 수동 설정 완료 목록은 다르다. 이전 답변의 GitHub `ORS_API_KEY` 존재 확인은 Edge Function secret 확인이 아니다.
- Cron: `zr-expire-rooms`, `*/15 * * * *`(매 15분). 9/11 등록 확인 기록 있음. 현재 활성/최근 실행 결과 및 다른 Cron 존재 여부는 모름.

## 4. 운영 검증 데이터 식별

- 운영에 검증용 익명 계정 4명 등을 만들고 그룹 테스트 기록을 남겼다는 배포 기록은 있다. **삭제 대상을 확정할 수 있는 닉네임·방 이름·맵 이름·ID 목록은 모름.** 코드 값은 기록하지 않는다.
- 운영 UI에서 `학의천`, `아침러닝`, `Ddd`라는 맵 이름을 본 적은 있다. **이것들이 검증용인지 실제 사용자 맵인지 모름. 절대 테스트 데이터 삭제 목록으로 쓰지 말 것.**
- 로컬 테스트 fixture의 닉네임이나 지도 이름은 운영에 생성됐다는 증거가 아니다. 운영 잔여 데이터 식별자로 복사하지 말 것.
- 테스트 데이터만 안전하게 일괄 정리할 수 있는 확정된 표시나 규칙: 모름.

## 5. 제보 4건의 수정 커밋과 테스트

### 종료 후 다시 방 만들기 오류
- `70cfeb9`: 자기 소유의 전원 종료 방을 정리한 뒤 다시 생성하도록 보완, 이전 오류 표시 정리.
- `tests/database.test.js`: `completed rooms can be closed by their owner while active rooms and final records survive`.
- 확인 범위는 SQL 수준의 소유권·종료 방 처리·기록 보존. 휴대폰 UI로 종료→재생성 전체 흐름을 재검증했다는 증거는 모름. 해당 SQL의 운영 적용도 위와 같이 미확인.

### 자유 모드에 기존 맵 경로가 적용됨
- `b4f6c6c`: 명시적으로 선택한 맵에서만 지정 경로 사용.
- `tests/App.test.jsx`: `free mode inside a saved map ignores its routes and spawns chasing zombies after sixty seconds`.
- `tests/RoomLobby.test.jsx`: `authored map selection is explicit when creating and starting a room (selected: %s)` (선택/미선택 두 경우).
- `tests/gameEngine.test.js`: `a selected map keeps zombies on the authored route instead of chasing the runner`도 지정 맵 측 동작을 검사.

### 두 번째 깃발/원형 구역 클릭 시 검은 화면
- `a370804`: 반복 클릭 반경 오류 보완과 자유 구역 편집 추가.
- `tests/AdminRouteEditor.test.jsx`: `second circle click and repeated flag clicks keep a finite radius`.
- 같은 파일의 polygon 클릭 저장/로드와 드래그 경계 테스트는 새 자유 구역 기능 검증이며 원래 오류 테스트와 구분할 것.

### 이메일 복구 문제(여러 원인)
- `699557c`: 인증 경로·복구 리디렉션 처리 및 접근 권한 보완의 기반. `tests/auth-handler.test.js`의 `recovery does not disclose registration or return email`, `reject redirects, excessive requests, oversized input and limiter failure` 등.
- `a74d5af`: 이메일 아이디 찾기 후 게임 화면 대신 확인된 아이디 표시. `tests/accountLanding.test.jsx`: `email recovery displays the verified username even after SDK removes URL markers`.
- `abc2c5c`: 기존 프로필 메타데이터 누락 대응. `tests/database.test.js`: `legacy profiles remain usable without username metadata and keep their stored username`.
- `9c065dc`: 만료 링크 안내 및 새 재설정 요청 유도. `tests/AuthScreen.test.jsx`: `expired recovery opens password reset request with clear latest-email guidance`.
- `c4f8fbf`: 기존 로그인 세션이 있어도 만료 안내 우선. `tests/recoveryExpired.test.jsx`: `expired recovery guidance wins even when an old signed-in session exists`.
- `bc93b64`: 재설정 제출 검증 테스트 추가(그 자체가 새 기능 수정 커밋은 아님). `tests/ResetPassword.test.jsx`의 짧거나 불일치한 비밀번호 차단, 중복 제출 방지, 만료/네트워크 실패 후 재시도 테스트.
- 실제 메일 수신→아이디 표시와 재설정 입력 화면까지는 과거 확인. 실제 사용자 비밀번호를 변경하는 최종 제출은 대신 하지 않음. localhost 이동 문제에서 운영 설정을 정확히 무엇으로 바꿨는지는 모름.

## 6. 기타

### 로컬 5초 제한을 넘긴 3개 테스트
1. `tests/App.test.jsx` — `double start only creates one GPS request and game loop; finishing stops GPS`
2. `tests/AppRanking.test.jsx` — `room ranking and final record work in free/map mode (map: false)`
3. `tests/RunDisplay.test.jsx` — `PIP uses an explicit tap, displays paused on hiding, and releases media on exit`

당시 전체 병렬 실행은 94개 통과/3개 타임아웃이었다. 이후 `--maxWorkers=2` 실행에서 97개 모두 통과했고 CI도 통과했다. 기계 부하가 원인이라고 확정 측정한 것은 아니므로 정확한 원인은 모름.

### DEPLOYMENT.md의 현재와 다른 부분
- `접근 진동 · 생존 랭킹 — 2026-09-21`: 70m/8초, 25m/3초의 2단계 설명은 과거 값. 이후 70/50/30/15m, 8/4/2/1초의 4단계로 변경됨.
- `반영 순서`: schema.sql이 두 마이그레이션만 합쳤다는 설명은 현재 틀림. 이후 마이그레이션이 누적됨. 두 초기 SQL만으로 최신 DB가 완성된다고 볼 수 없음.
- `현재 상태 — 2026-09-11`, `추가 검증 — 2026-09-13`, `운영 확인 > 2026-09-22 개인 생존 기록 및 추격 보완`: 당시 커밋·31/33/79개 테스트 수는 역사적 기록. 최신 상태 숫자는 아님.
- `추가 검증 — 2026-09-13`: 아래쪽 이메일 수신/아이디 결과 미검증 설명은 같은 섹션 위쪽 후속 검증 내용에 의해 일부 갱신됨. 비밀번호 최종 제출과 실기기 GPS 미검증은 여전히 남음.
- `운영 확인` 끝의 항목 나열은 확인할 체크리스트이지 전부 실행 성공했다는 기록이 아님.
- 그 밖에 현재 운영과 다른 부분 전체: 모름. 이번에는 문서의 역사적 내용을 삭제/수정하지 않고 이 보충 설명을 남김.

### 설치형 앱 방식과 사용자 의사
- Capacitor, React Native, Flutter 등 **특정 프레임워크를 제안하거나 확정한 기록은 없음**. 프레임워크 선택은 모름/미정.
- 기존 웹앱을 최대한 재사용하고, 백그라운드 위치·게임 진행을 별도로 구현하며, Android 테스트 앱부터 시작해 iPhone을 잇는 순서를 설명함.
- 사용자는 대상 기종 질문에 **“둘 다”**라고 답함. 화면 잠금 중 추적과 PIP를 원함. 크레딧 때문에 중단을 요청했다가 이후 작업 재개를 요청함.
- Android 우선 순서나 특정 네이티브 기술에 대해 사용자가 별도로 명시 동의/거절한 기록은 없음. Play 등록비와 무료 배포 방식은 질문·설명 단계이며 결제/가입 완료로 보지 말 것.

### 약속/요청 중 아직 안 된 것
- Android·iPhone에서 화면을 완전히 끈 동안 GPS·좀비 추격·러닝 기록을 계속하는 기능.
- 실제 휴대폰에서 PIP가 열리고 다른 앱 사용 중 원하는 동작을 하는지 확인. 웹 PIP 코드 추가만 완료했으며 성공 실기기 증거 없음.
- 설치형 Android/iOS 앱 생성, 서명, 기기 설치/현장 검증, 네이티브 백그라운드 실행. 앱 출시까지 완료했다고 약속/보고한 사실 없음.
- 실제 폰 GPS·진동·다중 기기 러닝과 수정 후 사용자 제보 회귀 검증. 자동 테스트만으로 대체하지 말 것.
- 확인 필요인 SQL 3개와 운영 설정의 현재 상태 대조. 이번 보충에서도 완료하지 않음.
- 실제 사용자 비밀번호 재설정 최종 제출은 보안상 사용자 직접 단계로 남김. 에이전트가 임의로 완료할 대상은 아님.
- 그 밖의 대화 전체에서 누락된 약속이 있는지 완전한 목록: 모름. 위 항목이 현재 근거로 특정 가능한 미완료 목록임.
