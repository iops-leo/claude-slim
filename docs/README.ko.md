<div align="center">

# claude-slim

**"안녕"이라고 말하기도 전에 수천 토큰이 사라지고 있습니다.**

매 세션마다 모든 스킬, 메모리 파일, 플러그인 지침이 시스템 프롬프트에 로드됩니다 — 한 번도 안 쓰는 것까지. claude-slim이 그 낭비를 찾아 제거합니다.

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

오버헤드가 숨어있는 곳:

| 항목 | 일반적인 오버헤드 |
|------|:---:|
| 60개 이상 등록된 스킬 | ~3,000 토큰 |
| CLAUDE.md (플러그인 지침) | ~5,000 토큰 |
| 메모리 파일 | ~2,500 토큰 |
| Deferred tools 목록 | ~1,500 토큰 |
| **합계** | **~12,000 토큰** |

응답이 느려집니다. 사용량 제한에 더 빨리 도달합니다. 안 쓰는 컨텍스트에 돈을 내고 있는 겁니다.

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
| **위험 영역 미접촉** | CLAUDE.md, settings.json, 플러그인 설정 절대 건드리지 않음 |

---

## 동작 원리

claude-slim은 아래 위치를 스캔합니다. 플러그인 특화 로직 없이 순수 파일시스템 분석.

```
~/.claude/
├── skills/                  ← 사용자 설치 스킬
├── plugins/cache/           ← 플러그인 스킬
├── CLAUDE.md                ← 시스템 지침 (읽기 전용)
├── projects/*/memory/       ← 자동 메모리 파일
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

---

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
