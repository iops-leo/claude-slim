<div align="center">

# claude-slim

**"안녕"이라고 말하기도 전에 수천 토큰이 사라지고 있습니다.**

매 세션마다 모든 스킬, 에이전트, 슬래시 커맨드, 메모리 파일, 플러그인 지침이 시스템 프롬프트에 로드됩니다 — 한 번도 안 쓰는 것까지. 매 턴마다 값을 치르고 있는 셈입니다. claude-slim은 그 시작 오버헤드를 측정하고 필요 없는 것을 걷어냅니다.

프록시도, 압축도, Claude Code가 API와 통신하는 방식을 바꾸지도 않습니다 — `~/.claude/`를 읽어 각 스킬과 플러그인이 실제로 얼마를 쓰는지 알려주고, 죽은 무게를 되돌릴 수 있게 치워둘 뿐입니다.

```
/claude-slim
```

[English](../README.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

</div>

---

### 실제 동작 보기

<p align="center">
  <img src="demo.gif" alt="claude-slim cleanup demo" width="900" />
</p>

오버헤드가 숨어있는 곳 — 실제 설치 환경 1대에서 측정한 값:

| 항목 | 비용 | |
|------|:---:|---|
| 스킬 목록 | ~10,100 토큰 | 스킬 256개 × 각자의 `이름: 설명` 한 줄 |
| 에이전트 카탈로그 | ~2,250 토큰 | `~/.claude/agents/`, 12개 |
| CLAUDE.md | ~2,000 토큰 | 플러그인 지침 |
| Deferred tools 목록 | ~1,500 토큰 | MCP 툴 스키마 |
| 슬래시 커맨드 | ~80 토큰 | `~/.claude/commands/` |
| 메모리 파일 | **0 ~ 63,500 토큰** | 현재 프로젝트만 — 프로젝트마다 편차가 큼 |

사람들이 가장 과소평가하는 항목이 스킬 목록입니다. 설치된 스킬 하나하나가 시스템 프롬프트에 `- 이름: 설명` 한 줄씩 더하는데, 이 한 줄이 **30토큰짜리부터 509토큰짜리까지** 있습니다. 스킬 60개라고 다 같은 청구서가 아닙니다.

응답이 느려집니다. 사용량 제한에 더 빨리 도달합니다. 안 쓰는 컨텍스트에 돈을 내고 있는 겁니다 — 매 세션, 매 턴마다.

---

## 명령어 하나. 5단계 파이프라인.

```
/claude-slim
```

```
 ┌────────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐   ┌────────┐
 │  스캔  │ → │  분류    │ → │  제안   │ → │  정리   │ → │ 리포트 │
 │        │   │          │   │         │   │         │   │        │
 │ 모든   │   │ 깨진     │   │ 사용자가│   │.disabled│   │before  │
 │ 소스   │   │ 중복     │   │  선택   │   │  로     │   │  vs    │
 │ 측정   │   │ 비대     │   │         │   │  이동   │   │ after  │
 └────────┘   └──────────┘   └─────────┘   └─────────┘   └────────┘
```

**스캔** — 모든 것을 측정: 로컬 스킬, 플러그인 스킬, CLAUDE.md, 메모리 파일, MCP 서버. [js-tiktoken](https://github.com/nicolo-ribaudo/js-tiktoken)으로 정확하게 카운팅합니다.

**분류** — 낭비를 자동으로 찾아냄:

| | 탐지 대상 |
|---|---|
| 깨진 심볼릭 링크 | 스킬팩 제거 후 남은 죽은 링크 |
| 중복 스킬 | 여러 소스에서 같은 스킬 등록 |
| 빈 템플릿 | 내용 없는 플레이스홀더 스킬 |
| 대용량 파일 | 10KB 이상 SKILL.md |
| **미사용 스킬** | **최근 N일(기본 60일) 세션에서 한 번도 호출되지 않은 로컬 스킬** |
| 에이전트·커맨드 | `~/.claude/agents/`, `~/.claude/commands/` — 측정·보고만 하고 변경하지 않음 |
| 오래된 메모리 | 매 세션 로드되는 대용량 메모리 파일 |
| 비활성 플러그인 | 설치됐지만 비활성화된 채 캐시 점유 |
| 오래된 프로젝트 | 90일 이상 미사용 프로젝트 메모리 |
| 임시 캐시 | 실패한 플러그인 설치 잔여물 (`temp_local_*`) |

**제안** — 3단계로 분류, 당신이 결정:

| 단계 | 동작 | 예시 |
|------|------|------|
| **Auto** | 자동 선택 | 깨진 링크, 빈 템플릿, 임시 캐시 |
| **Recommended** | 권장 | 중복, 오래된 메모리, 비활성 플러그인, 오래된 프로젝트 |
| **Optional** | 사용자 판단 | 아직 쓸 수 있는 대용량 스킬 |

**정리** — 선택한 스킬과 프로젝트 메모리를 `~/.claude/skills.disabled/`로 이동. 실패한 설치 임시 캐시와 죽은 symlink 파일만 영구 정리되며, 선택 전에 permanent로 표시됩니다.

**리포트** — 정확히 뭐가 바뀌었는지 보여줌:

```
╭──────────────────────────────────────────╮
│  claude-slim report                      │
│                                          │
│  Before: 14,510 tokens at startup        │
│  After:   5,181 tokens at startup        │
│  Saved:   9,329 tokens (64.3%)           │
│                                          │
│  Top offenders removed:                  │
│  • office-hours              23,008 tok  │
│  • harness                    7,902 tok  │
│  • manpower                   4,764 tok  │
│                                          │
│  Est. monthly savings: ~$1.68            │
│  (2 sessions/day × $0.003/1K tok)        │
╰──────────────────────────────────────────╯

  ┌──────────────────┬──────────┬──────────┬────────────┐
  │                  │  Before  │  After   │  Saved     │
  ├──────────────────┼──────────┼──────────┼────────────┤
  │ 로컬 스킬        │    14    │     4    │  -10       │
  │ 시스템 프롬프트    │   ~124   │   ~114   │  -10       │
  │ 메모리 파일       │  19.5KB  │   5.7KB  │  -13.8KB   │
  │ 예상 토큰        │ ~14,510  │  ~5,181  │  ~9,329    │
  └──────────────────┴──────────┴──────────┴────────────┘
```

---

## 설치 (10초)

```bash
claude plugin marketplace add iops-leo/claude-slim
claude plugin install claude-slim
```

아무 세션에서 `/claude-slim` 입력하면 끝.

또는 독립 CLI:

```bash
npx claude-slim scan
```

---

## 사용법

```bash
/claude-slim              # 전체 파이프라인: 스캔 → 제안 → 정리 → 리포트
/claude-slim scan         # 리포트만 (변경 없음)
/claude-slim scan --json  # JSON 출력
/claude-slim doctor       # 스캐너 전제조건과 세션 로그 신뢰도 점검
/claude-slim restore      # 비활성화한 항목 복원
```

CLI:

```bash
npx claude-slim clean             # 전체 파이프라인
npx claude-slim clean --dry-run   # 변경 없이 미리보기
npx claude-slim clean --auto      # 비대화형, Tier 1만 자동 정리 (CI/스크립트용)
npx claude-slim scan              # 리포트만
npx claude-slim doctor            # Node/Claude/세션 로그 준비 상태 진단
npx claude-slim restore           # 복원
npx claude-slim report            # 지난 정리의 절감 리포트
```

---

## 안전 최우선

| | |
|---|---|
| **사용자 데이터 비파괴** | 스킬과 프로젝트 메모리는 `~/.claude/skills.disabled/`로 이동 |
| **복구 가능** | 이동된 스킬과 프로젝트 메모리는 `/claude-slim restore`로 복구 |
| **사용자 제어** | 대화형 실행은 변경 전 확인 요청. `--dry-run`으로 미리보기, `--auto`는 Tier 1만 선택. |
| **위험 영역 미접촉** | CLAUDE.md, settings.json, 플러그인 설정, `~/.claude/agents/`, `~/.claude/commands/` 절대 건드리지 않음 |
| **경로 봉쇄** | 대상 경로가 `~/.claude/`를 벗어나면 모든 파괴적 작업을 거부 |

---

## 동작 원리

claude-slim은 아래 위치를 스캔합니다. 플러그인 특화 로직 없이 순수 파일시스템 분석.

```
~/.claude/
├── skills/                  ← 사용자 설치 스킬
├── plugins/cache/           ← 플러그인 스킬·에이전트·커맨드·MCP 서버
├── agents/                  ← 사용자 에이전트 (측정만, 읽기 전용)
├── commands/                ← 사용자 슬래시 커맨드 (측정만, 읽기 전용)
├── CLAUDE.md                ← 시스템 지침 (읽기 전용)
├── projects/*/memory/       ← 자동 메모리 파일 (현재 프로젝트만 시작 비용에 포함)
└── settings.json            ← MCP 서버 수 (읽기 전용)
```

어떤 조합이든 동작합니다: OMC, gstack, 커스텀 스킬, 마켓플레이스 플러그인, 또는 바닐라 Claude Code.

---

## 실제 결과

수개월간 스킬이 누적된 환경의 실제 정리 결과:

| 지표 | Before | After | |
|------|:------:|:-----:|---|
| 로컬 스킬 | 65 | 15 | **-77%** |
| 시스템 프롬프트 스킬 | ~80 | ~48 | **-40%** |
| 메모리 파일 | 15KB | 2KB | **-87%** |
| **예상 토큰 절감** | | **~4,300/세션** | |

### 숫자에 관하여

claude-slim은 **지금 이 디렉터리**에서 세션을 열었을 때의 비용을 보고합니다. 메모리는 프로젝트 단위입니다 — Claude Code는 현재 프로젝트의 `~/.claude/projects/<slug>/memory/`만 로드하지, 디스크에 있는 모든 프로젝트를 로드하지 않습니다. 그래서 서로 다른 저장소에서 `scan`을 돌리면 총합이 다르게 나오는 게 정상입니다.

토큰 수는 [js-tiktoken](https://github.com/nicolo-ribaudo/js-tiktoken)으로 실제 파일 내용을 세서 구합니다. 추정값으로 남은 건 `~` 표시가 붙은 두 가지뿐입니다: MCP 툴 스키마(툴당 ~8토큰), 그리고 frontmatter를 파싱할 수 없는 스킬(~30토큰). 나머지는 전부 실측입니다.

---

## v2.8.0 변경사항 (2026-07-25)

정확도 릴리스. 보고하던 숫자 3개가 틀렸고, 그중 가장 큰 값은 자릿수 단위로 틀렸습니다. **업그레이드 후 시작 토큰 추정치가 크게 줄었다면, 틀렸던 쪽은 기존 숫자입니다.**

- **시작 토큰 추정에서 전체 프로젝트 메모리 합산 제거.** Claude Code는 현재 프로젝트의 `memory/`만 로드하는데 디스크상의 모든 프로젝트를 더하고 있었습니다. 즉 "tokens at session start"라는 이름의 값이 지금까지 열어본 프로젝트 수에 비례해 커졌습니다. 개발 머신 기준 **116,259 토큰으로 보고되던 값의 실제 세션 비용은 14,399**였습니다. 이제 현재 프로젝트로 한정되며, 전체 합계는 "per-session 비용 아님" 라벨과 함께 따로 표시됩니다.
- **스킬 목록 비용을 상수가 아닌 실측으로 전환.** 각 스킬은 시스템 프롬프트에 `- 이름: 설명` 한 줄을 더하는데, 기존에는 전부 고정값 30토큰으로 계산했습니다. 설치된 스킬 68개 실측 분포는 **30~509 토큰(평균 51)** — 총합 기준 70% 과소 계상이었습니다. v2.7.0의 플러그인별 비용 그래디언트가 "설명이 긴 스킬 5개"와 "짧은 스킬 5개"를 구분하지 못하던 문제도 함께 해소됐습니다.
- **`~/.claude/agents/`, `~/.claude/commands/` 스캔 추가.** 매 세션 시스템 프롬프트에 올라가는데도 스캐너에서 완전히 누락돼 있었습니다(개발 머신 기준 에이전트 12개 ~2,254 토큰). **측정·보고 전용** — 이동·삭제하지 않습니다. 복원 경로가 없는 상태에서 파괴적 동작을 넣으면 이 도구의 핵심 약속이 깨지기 때문입니다.
- **플러그인 매니페스트 버전 고착 수정.** `.claude-plugin/*`이 3개 릴리스 동안 2.7.0에 머물러 있었습니다. `claude plugin install`은 `package.json`이 아니라 매니페스트를 읽으므로 플러그인 사용자에게 계속 구버전이 보고됐습니다. CI 검사(`npm run check:versions`)로 재발을 막습니다.
- **토큰 캐시 무한 증식 수정.** 개발 머신 기준 776개 중 355개(46%, 139KB)가 이미 삭제된 파일을 가리켰습니다.

테스트: 206 → **241 (+35)**.

---

## v2.7 변경사항

- **미사용 플러그인 감지** — 세션 트랜스크립트에서 MCP 도구 호출(`mcp__plugin_<플러그인>_<서버>__*`)과 슬래시 커맨드를 함께 파싱해 최근 60일 동안 스킬·MCP·커맨드 어느 것도 호출되지 않은 플러그인을 표시합니다. Tier 3(Optional, 기본 미선택)이라 사용자가 판단합니다. 정리 시 `claude plugin disable <name>`이 자동 실행되고, `/claude-slim restore`로 되돌립니다.
- **PLUGIN BREAKDOWN 테이블** — 스캔 리포트에 플러그인별 토큰 비용(CLAUDE.md 섹션 + 스킬 등록 + MCP deferred 도구 + 커맨드)과 사용 상태(used / unused / agent-only / insufficient data / disabled)가 담긴 표가 추가됐습니다. 실제 환경 상위 예시: `oh-my-claudecode` ~6,210 tok, `pm-skills` 계열 합계 ~2,500 tok.
- **세션 파서 버그 수정** — 문자열 형태의 user 메시지(직접 슬래시 커맨드)가 무시되던 문제 수정. 이제 문자열·배열 양쪽 콘텐츠에서 슬래시 커맨드가 정확히 집계됩니다.
- **+82 테스트** 추가 (신규 모듈 + 파서 회귀).

## v2.7.1 (2026-07-20)

- **`unused_plugin` 절감량이 항상 0이던 문제 수정** — 감지기가 계산된 플러그인 비용을 실제로 사용하지 못해 dry-run과 리포트가 절감량을 과소집계하던 버그. `pluginCosts` 맵을 DetectorContext에 배선해 실제 값을 반영합니다.
- **`duplicate` 감지기의 네임스페이스 오탐 수정** — `org/ship` 같은 네임스페이스 로컬 스킬이 플러그인의 동명 `ship`과 중복으로 잘못 분류되던 문제. 이제 완전한 이름 일치만 중복으로 판정합니다.
- **`stale_project` 복원 시 경로 스코프 강화** — 조작된 매니페스트가 project-memory 백업을 스킬 디렉토리로 리다이렉트할 수 있던 취약점을 타입별 서브트리 가드로 차단.
- **비대화형 셸에서 `--auto`/`--dry-run` 없이 clean 실행 시 거부** — 이전엔 조용히 Tier 1을 자동 적용했지만, 이제 경고 후 exit 1로 사용자 명시 opt-in 요구.
- **`--lookback-days 0` 및 `--sessions-per-day 0` 존중** — `parseInt() || N`이 explicit 0을 기본값으로 승격하던 버그 수정.
- **`claude-slim report`가 zero-token 정리(broken_symlink/temp_cache)만 있는 이력도 표시**.

## v2.6 변경사항

- **`claude-slim doctor`** — Node 지원 여부, `~/.claude/` 접근성, 로컬 스킬/플러그인 캐시 접근, `claude plugin list`, 최근 세션 로그 신뢰도를 점검. 스캔 결과가 비어 보이거나 미사용 스킬 탐지가 suppress될 때 원인을 확인할 수 있습니다.
- **더 정확한 안전 문구** — 스킬과 프로젝트 메모리는 `~/.claude/skills.disabled/`로 이동되어 복구 가능하고, 깨진 symlink 파일과 실패한 `temp_local_*` 캐시만 permanent 정리 대상으로 표시됩니다.
- **개발 Node 버전 고정** — `.nvmrc`와 `.node-version`을 Node 22.12.0으로 고정해 Vitest/Vite/Rolldown의 현재 patch-floor 요구사항과 맞췄습니다.

## v2.4 변경사항

- **미사용 스킬 탐지** — `~/.claude/projects/*/*.jsonl` 세션 트랜스크립트를 읽어 최근 60일 동안 한 번도 `Skill` 도구로 호출되지 않은 로컬 스킬을 찾아 표시. Tier 3 (Optional, 기본 미선택) 이라 사용자가 직접 고름. `--lookback-days <n>` 으로 윈도우 조절 가능. 세션 데이터가 부족하거나(3개 미만) 호출 이벤트가 0건이면(스키마 변경 가능성) 분류를 통째로 suppress — 데이터 신뢰도 떨어질 때 잘못된 시그널 안 냄.
- **플러그인 스킬은 의도적으로 제외**. `~/.claude/plugins/cache/` 아래 스킬은 Claude Code 플러그인 런타임이 관리하므로, 파일을 옮기면 플러그인이 부분 언인스톨 상태가 됨. 플러그인 단위 정리는 `claude plugin disable <name>` 사용.
- **세션 사용 캐시** — `~/.claude/.skill-usage-cache.json`에 mtime 키로 저장. 워밍 스캔에선 변경된 세션 로그만 다시 파싱.
- **Node 20+** 가 새로운 엔진 최저 버전 (이전 `>=18` — 단, Node 18은 이미 v2.3.0에서 CI matrix에서 제거됨).

## v2.3 변경사항

- **detector 레지스트리 리팩터 (v2.3.0)** — 588줄 단일 모듈이던 스캐너를 `src/scanner/` 하위의 세분화된 detector들로 분리. 새 휴리스틱 추가가 함수 하나 추가로 끝남 (CONTRIBUTING.md 참고). 공개 API는 그대로.
- **경로 봉쇄 가드 (v2.2.3)** — 모든 destructive 작업이 `~/.claude/` 바깥 경로를 거부. `runCommand`는 더 이상 셸을 거치지 않음. `temp_cache` 정리는 symlink-safe.
- **리포트 부호 수정 (v2.2.3)** — 2.2.x 초기에 분해 테이블의 Saved 컬럼 부호가 뒤집혀 있던 버그 수정. 이제 행별로 올바른 절감량 표시.
- **85개 테스트 (이전 73개)** — 경로 봉쇄, restore 가드, 분해 테이블 부호, restore-selection 중복 제거, 토큰 캐시 atomic flush, 커스텀 detector 주입 테스트 추가.

## v2.2 변경사항

- **`stale_project` 원자적 clean/restore** — 파일 단위 루프 대신 단일 디렉토리 `rename()`. 중간에 중단되어도 파일이 양쪽에 분산되는 부분 실패 상태 제거.
- **명확한 충돌 에러 메시지** — 백업이 이미 존재하는 프로젝트를 재정리하거나 기존 디렉토리 위에 restore할 때, OS의 난해한 에러 대신 실행 가능한 안내 출력.
- **매니페스트 v2 스키마** — 현재 비활성화된 항목만 담는 단일 JSON 파일(`manifest.json`). restore가 항목을 완전히 제거하므로 여러 clean/restore 사이클을 반복해도 매니페스트 크기가 무한 증가하지 않음.
- **v1 자동 마이그레이션** — 기존 레거시 매니페스트(`.claude-slim-manifest.jsonl`)는 첫 실행 시 v2로 자동 변환. 원본은 `.jsonl.bak`로 보존.
- **충돌 안전 쓰기** — tmp 파일 작성 후 atomic rename 패턴 적용. 정전·SIGKILL에도 매니페스트 파일 손상 없음.
- **테스트 커버리지 확장** — 66개 테스트 (이전 35개). 이슈 타입별 round-trip 테스트 추가: `broken_symlink`, `template`, `duplicate`, `skill_dup`, `oversized_skill`, `temp_cache`, `stale_project`. 매니페스트 마이그레이션·bounded-growth 사이클 테스트 포함.

## v2.0 변경사항

- **TypeScript CLI** — bash에서 전환. 더 빠르고, 정확하고, 확장 가능.
- **정확한 토큰 카운팅** — [js-tiktoken](https://github.com/nicolo-ribaudo/js-tiktoken)의 `cl100k_base` 인코딩 사용.
- **절감 리포트 박스** — Before/After + 항목별 비교 테이블 + 월간 절감 추정.
- **`--dry-run`** — 변경 없이 미리보기.
- **`--json`** — 자동화용 JSON 출력.
- **토큰 캐시** — 반복 스캔 즉시 완료.
- **독립 CLI** — `npx claude-slim`으로 Claude Code 밖에서도 사용 가능.
- **`--auto`** — CI/스크립트용 비대화형 정리 (Tier 1만 자동 선택).
- **비활성 플러그인 감지** — 비활성화했지만 삭제하지 않은 플러그인 발견.
- **오래된 프로젝트 감지** — 90일 이상 미사용 프로젝트 메모리 플래그.
- **CLAUDE.md 섹션 분석** — 어떤 플러그인 지침이 토큰을 가장 많이 차지하는지 확인.
- **플러그인 상태 표시** — 각 플러그인의 enabled/disabled 상태 표시.
- **Non-TTY 지원** — stdin이 파이프일 때 자동으로 Tier 1 선택.
- **유닛 테스트** — vitest 기반.

---

## 요구사항

- Node.js 20+
- macOS 또는 Linux
- Claude Code CLI

## 라이선스

MIT
