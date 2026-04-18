# claude-slim 개선 백로그 (v2.2+)

> **Status**: Draft
> **Date**: 2026-04-18
> **Scope**: v2.1.0 출시 이후 공개 플러그인으로서 개선할 항목의 우선순위화된 백로그
> **Format**: 우선순위(P0/P1/P2) 기준 섹션화, 카테고리(A~E) 라벨 병기

---

## 1. Summary

claude-slim v2.1.0은 TypeScript 재작성과 js-tiktoken 기반 정확 토큰 측정을 달성했다. 본 문서는 **공개 플러그인(npm + Claude Code marketplace)** 기준으로 다음 릴리즈 이후의 개선 후보를 정리한다. 총 28항목을 **데이터 안전(P0) → 중요(P1) → nice-to-have(P2)** 순으로 분류하고, 각 항목을 `Title / Category / Problem / Fix / Effort / Breaking`로 기록한다.

## 2. Goals / Non-goals

### Goals
- 공개 플러그인 사용자 기준 리스크 항목을 우선 가시화
- 다음 릴리즈(v2.2) 스코프 결정 근거 제공
- 외부 기여자가 "어디서부터 손대면 좋을지" 판단할 수 있는 단일 문서 확보

### Non-goals
- 각 항목의 상세 구현안 (writing-plans 단계에서 분기)
- 의존성 그래프 전체 도식화
- 마케팅/배포 전략

## 3. 카테고리 정의

| 코드 | 이름 | 설명 |
|---|---|---|
| A | 버그/리스크 | 잠재 결함, 테스트 공백, 데이터 유실 가능성 |
| B | 아키텍처/유지보수 | 모듈 분리, 타입 정비, 추상화 개선 |
| C | 기능 확장 | Windows, config 파일, 신규 플래그, UI |
| D | DX/운영 | CI, lint, 릴리즈 자동화, 커버리지 |
| E | i18n/문서 | CLI 다국어, 번역 drift, 기여 문서 |

## 4. 우선순위 / Effort 정의

### 우선순위
| | 기준 | 처리 시점 |
|---|---|---|
| **P0** | 데이터 안전 또는 사용 시간 경과에 따른 자연 악화 | v2.2 출시 전 필수 |
| **P1** | 공개 플러그인 품질 기준 중요. 호환성/확장성 영향 | v2.2~v2.3 내 처리 권장 |
| **P2** | UX/편의/문서. 커뮤니티 기여 수용 가능 | 여력 또는 기여자 맞춤 |

### Effort
| | 기준 |
|---|---|
| **S** | 1일 이내. 단일 파일/단일 함수 수준 변경 또는 기존 패턴 반복 |
| **M** | 1~3일. 다수 파일 수정 또는 신규 추상화 1개 도입 |
| **L** | 3일 이상. 아키텍처 변경 또는 외부 의존성 포함 (현 백로그에는 없음) |

---

## 5. P0 — 릴리즈 블로커 / 데이터 안전

| # | Title | Cat | Problem | Fix | Effort | Breaking |
|---|---|---|---|---|---|---|
| 1 | cleaner/restore 테스트 공백 | A | `cleaner.ts`와 `restore` 플로우는 fs를 실제로 이동·삭제하는 가장 위험한 계층인데 테스트가 0개 (`src/__tests__/`에 scanner/selection/report만). 회귀 시 사용자 데이터 유실 가능 | `tmp-promise`로 격리한 vitest에서 이슈 타입별 **clean → restore round-trip** 테스트. 각 타입별 최소 1케이스 | M | N |
| 2 | manifest 무한 append-only | A | `cli.ts:67` restore 시 기존 엔트리 제거 없이 `restored` 항목 append만. 영구 사용자는 수MB까지 성장 + Set 필터 비용 | schema v2 도입 — `{active:[], archived:[]}` 구조로 전환, restore 시 active에서 제거. manifest v1 자동 migration 포함 | S | Y |
| 3 | restore 부분 실패 복구 없음 | A | `cleaner.ts:74` stale_project restore 루프가 중간 실패하면 파일이 원본·백업 디렉토리에 분산. 롤백 없음 | 디렉토리 단위 atomic `rename`으로 전환 (개별 파일 루프 제거), 또는 실패 시 이동된 파일 역이동 | S | N |

---

## 6. P1 — 중요 (v2.2 또는 v2.3 내 처리 권장)

| # | Title | Cat | Problem | Fix | Effort | Breaking |
|---|---|---|---|---|---|---|
| 4 | CLAUDE.md 섹션 파서 오탐 | A | `scanner.ts:336` `parseClaudeMdSections`가 `#` 헤딩만 보고 코드 펜스 ` ``` ` 안의 `# comment`도 섹션으로 분할 → 토큰 수 분산 표시 | 파서에 fence 상태(`inCodeBlock`) 추가. 간단한 유한상태 | S | N |
| 5 | `claude plugin list` 파싱 fragile | A | `scanner.ts:312` 유니코드 화살표(`❯`)로 파싱. CLI 출력 포맷 변경 시 조용히 실패 → disabled 플러그인 감지 누락 | `claude plugin list --json` 존재 확인 후 우선 사용, fallback으로 현 파서 유지. 파싱 결과 검증 로그 추가 | S | N |
| 6 | `contentCache` 모듈 스코프 mutable | A | `scanner.ts:72` top-level `Map`. 프로그램적으로 `scan()` 재호출 시 누적. 테스트 격리도 어려움 | `scan()` 내부 지역 Map으로 이동 + 필요한 함수에 인자로 전달 | S | N |
| 7 | `getDirSize` 심볼릭 링크 순환 미보호 | A | `scanner.ts:57`가 `stat`(follow) 사용. 순환 링크 만나면 무한 루프 가능 | `lstat`으로 변경해 링크 건너뛰기, 또는 visited inode Set | S | N |
| 8 | scanner.ts 580줄 분리 | B | 심볼릭 처리·dedup·classify·CLAUDE.md 파싱·MCP·stale까지 한 파일. 테스트 타겟팅 어려움 | `scanner/{skills,plugins,memory,claudemd,mcp,classify}.ts`로 분리, `scan()`는 오케스트레이터만 | M | N |
| 9 | 하드코딩 임계값 | B | `STALE_DAYS=90`, 오버사이즈 10KB/5KB, 가격 `$0.003` 등 상수 7+개 산재. 사용자 튜닝 불가 | config 파일(#12)과 연계. default는 현 값 유지 | S | N |
| 10 | ANSI 색상 인라인 산재 | B | `\x1b[31m` 등 raw 이스케이프가 3개 파일에 흩어짐. 테스트·색상 토글 불가 | `colors.ts` 헬퍼 (`red()`, `yellow()`, `dim()`). `NO_COLOR` env 지원 | S | N |
| 11 | Issue/Manifest 타입 정비 | B | `ManifestEntry`에 optional 필드 난립, `type`으로 분기 (`cleaner.ts:38`). discriminated union 활용 안 함 | `type` 리터럴 기반 discriminated union 정의, `action` 분기 타입세이프 | S | N |
| 12 | config 파일 도입 | C | threshold/가격/제외 패턴/sessions-per-day 모두 CLI 플래그나 상수. 공개 플러그인 기준 커스터마이즈 어려움 | `~/.claude/.claude-slim.json` 로더, 플래그 > config > default 우선순위. schema 검증 | M | N |
| 13 | 모델별 가격 지원 | C | `report.ts:9` Sonnet `$0.003` 고정. Opus/Haiku 사용자 월 절감액 크게 틀어짐 | `--model sonnet\|haiku\|opus` 플래그 + config. 가격은 상수 테이블 관리. 또는 "tokens only" 표시 옵션 | S | N |
| 14 | Windows 지원 검증 | C | README는 macOS/Linux만 명시. `homedir()`·path sep는 OK지만 symlink 로직·`exec`로 `claude` 호출은 Windows 동작 미검증 | CI matrix에 windows-latest 추가, symlink fallback(junction), `.cmd` 경로 탐색. 실제 시나리오 스모크 테스트 | M | N |
| 15 | GitHub Actions CI | D | CI 파이프라인 없음. PR에서 build/test 자동 검증 불가 | `ci.yml`: node 18/20/22 × ubuntu/macos/windows matrix, `npm test` + `npm run build` + 커버리지 업로드 | S | N |
| 16 | ESLint + Prettier | D | lint/format 설정 없음. 공개 플러그인에서 기여자 PR 스타일 통일 어려움 | `@typescript-eslint` + prettier 기본 config, `npm run lint` 스크립트, CI에 포함 | S | N |
| 17 | 커버리지 리포트 + 임계치 | D | `vitest run`만 실행, 커버리지 측정 없음. P0-1 테스트 추가 후에도 사각지대 파악 불가 | `vitest --coverage` + 커버리지 임계치 (lines 80%). CI에서 codecov 업로드 | S | N |

### P1 항목 간 의존성
- **#9 하드코딩 상수** → **#12 config 파일** 선행 필요 (번들 처리 권장)
- **#15 CI** → **#14 Windows** 검증 수단 제공
- **#1 cleaner 테스트 (P0)** → **#17 커버리지** 임계치 설정 근거

---

## 7. P2 — Nice-to-have

| # | Title | Cat | Problem | Fix | Effort | Breaking |
|---|---|---|---|---|---|---|
| 18 | JSON 출력 전면 지원 | C | 현재 `scan --json`만 있음. `clean`·`restore`·`report`는 사람 전용 출력 → 자동화/CI 활용 제한 | 모든 커맨드에 `--json`, 공통 출력 schema 정의 (`version`, `command`, `result`) | S | N |
| 19 | 제외 패턴 | C | 사용자가 "이 스킬은 큰데도 유지"를 선언할 방법 없음. 매번 수동 선택 | `--exclude <glob>` 플래그 + config의 `keep:[]`. 매칭된 스킬은 오버사이즈 목록에서 제거 | S | N |
| 20 | 인터랙티브 multi-select UI | C | `1,3,5` 텍스트 입력 방식. 공개 플러그인 기준 UX 약점 | `@inquirer/prompts` 도입, 체크박스 UI. non-TTY면 기존 텍스트 방식 유지 | S | N |
| 21 | 리포트 내보내기 | C | 저장/공유 불가 (stdout only). 팀 공유·변경 추적용으로 쓰기 어려움 | `--output report.md` / `--output report.json` 플래그. 박스 → markdown 표 변환 | S | N |
| 22 | `restore --dry-run` | C | clean은 dry-run 있지만 restore는 없음. 복원 전 미리보기 불가 | cli.ts restore 핸들러에 `--dry-run` 플래그 추가. 매니페스트 조회만 하고 rename 생략 | S | N |
| 23 | CLI 출력 i18n | E | README는 한/일/중 번역되어 있으나 CLI 출력은 영어 전용. 대상 사용자 모순 | `$LANG` 또는 `--lang ko\|ja\|zh\|en` 플래그. `i18n/{locale}.json`로 메시지 분리 | M | N |
| 24 | 다국어 README drift 감지 | E | `README.md` 수정 시 ko/ja/zh가 뒤처지는 구조. 공개 플러그인에서 흔한 부채 | CI 스크립트: 영어 README 변경 감지 시 다른 언어에 `[NEEDS UPDATE]` 코멘트 또는 PR 체크 실패 | S | N |
| 25 | 데모 GIF/asciinema | E | 설치 후 동작 미리보기 불가. README가 텍스트 위주라 설득력 약함 | `asciinema rec`로 `/claude-slim` 전체 플로우 녹화, `agg`로 GIF 변환해 README 상단 삽입 | S | N |
| 26 | CONTRIBUTING + ARCHITECTURE | E | `CONTRIBUTING.md` 1.6KB로 빈약. 내부 아키텍처·heuristic 근거 문서 없음 → 외부 기여 장벽 | `docs/ARCHITECTURE.md`(scanner 구조, 3-tier 분류 근거, manifest 스키마), `CONTRIBUTING.md`에 개발 워크플로/테스트 실행법 보강 | M | N |
| 27 | release 자동화 | D | 수동 `npm version` → `npm publish`. 릴리즈노트 수기 작성 | `release-please` 또는 changesets 도입. Conventional Commits 기반 자동 버전 bump + CHANGELOG + GitHub Release | S | N |
| 28 | Dependabot / Renovate | D | 의존성 업데이트 수기. commander/vitest/tsc 버그픽스 누락 위험 | `.github/dependabot.yml` weekly, patch는 자동 merge label, major는 수동 리뷰 | S | N |

---

## 8. 전체 구성 요약

| 구분 | 항목 수 | 카테고리 분포 | 합계 Effort |
|---|---|---|---|
| P0 | 3 | A×3 | S×2, M×1 |
| P1 | 14 | A×4, B×4, C×3, D×3 | S×11, M×3 |
| P2 | 11 | C×5, D×2, E×4 | S×9, M×2 |
| **합계** | **28** | A×7, B×4, C×8, D×5, E×4 | S×22, M×6 |

- Breaking change 항목: **#2 manifest schema v2 단 1건**. 나머지는 additive.
- 평균 난이도 S (약 1일) 중심. 단일 PR로 쪼개기 용이.

## 9. v2.2 권장 스코프 제안 (참고)

본 문서는 백로그 정리가 목적이며 스코프 확정은 별도 결정이지만, 일반적인 기준선을 제안한다:

### Minimum (안정화 릴리즈)
- **P0 전부** (#1, #2, #3)
- **P1 중 저위험 S**: #4, #6, #7, #10, #11 (코드 펜스 파서, contentCache, symlink 가드, 색상 헬퍼, 타입 정비)

### Standard (기능 확장 포함)
- Minimum + **#12 config 파일 + #9 하드코딩 상수 + #13 모델별 가격** (번들)
- **#15 CI + #16 lint + #17 커버리지** (DX 일괄)

### Extended (Windows 지원 포함)
- Standard + **#14 Windows 검증 + #5 plugin list 파싱 보강**

---

## 10. 다음 단계

1. 본 spec에 대한 사용자 리뷰 및 조정
2. v2.2 스코프 확정 (Minimum / Standard / Extended 중 택)
3. 확정된 항목에 대해 `writing-plans` 스킬로 구현 플랜 작성
4. 각 P0 항목은 단일 PR 단위로 실행 권장 (리뷰 부담 최소화)
