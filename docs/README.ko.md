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

```mermaid
flowchart LR
    A["<b>스캔</b><br/>모든 소스 측정"] --> B["<b>분류</b><br/>깨짐 · 중복 · 비대"]
    B --> C["<b>제안</b><br/>사용자가 선택"]
    C --> D["<b>정리</b><br/>.disabled로 이동"]
    D --> E["<b>리포트</b><br/>before vs after"]
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
```

| | Before | After | 절감 |
|---|:---:|:---:|:---:|
| 로컬 스킬 | 14 | 4 | -10 |
| 시스템 프롬프트 | ~124 | ~114 | -10 |
| 메모리 파일 | 19.5KB | 5.7KB | -13.8KB |
| 예상 토큰 | ~14,510 | ~5,181 | ~9,329 |

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
/claude-slim check-update # 더 새 버전이 나왔는지 확인
/claude-slim restore      # 비활성화한 항목 복원
```

CLI:

```bash
npx claude-slim clean             # 전체 파이프라인
npx claude-slim clean --dry-run   # 변경 없이 미리보기
npx claude-slim clean --auto      # 비대화형, Tier 1만 자동 정리 (CI/스크립트용)
npx claude-slim scan              # 리포트만
npx claude-slim doctor            # Node/Claude/세션 로그 준비 상태 진단
npx claude-slim doctor --offline  # 버전 확인 없이 진단 (네트워크 미사용)
npx claude-slim check-update      # 버전 확인만 (변경 없음)
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
| **Codex 읽기 전용** | `~/.codex/`는 있으면 측정·보고만 하고 이동·삭제하지 않음 |

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

## v2.10.0 변경사항 (2026-08-02)

Codex 지원. 단, Codex에게 실제로 물어볼 수 있는 것까지만.

- **`~/.codex/`가 있으면 자동으로 스캔합니다.** 로컬 스킬, 플러그인 스킬, 에이전트, `AGENTS.md`의 시작 비용을 별도 섹션으로 보고합니다. `scan --json`에 `codex` 키가 추가되고 `--no-codex`로 끌 수 있습니다. 개발 머신에서 **아무도 재고 있지 않던 10,926 토큰**이 드러났고, 그중에는 매 세션 285 토큰을 먹고 있던 스킬 백업본(`.bak`)도 있었습니다.
- Codex의 `SKILL.md` 프론트매터가 Claude Code와 형식이 같아서 기존 파서를 그대로 씁니다. 에이전트만 `<이름>.toml`의 `description = "…"` 형식이라 전용 파서를 붙였고, 설치된 18개 전부로 검증했습니다.
- **미사용 스킬 탐지는 Codex에 제공하지 않고, 그 사실을 리포트에 밝힙니다.** Codex 세션 로그에 남는 건 호출 기록이 아니라 시스템 프롬프트에 주입된 스킬 **목록**입니다. 거의 모든 스킬이 거의 모든 세션에 등장하므로 이걸 사용 신호로 쓰면 전부 "사용 중"으로 판정됩니다. 세션 파일 408개, 로그 DB 56,724행, 도구 등록 테이블까지 확인한 뒤 내린 결론입니다.
- **`~/.codex/`는 읽기 전용입니다.** `~/.claude/agents/`와 마찬가지로 이동도 삭제도 하지 않습니다.

- **백업 아티팩트 탐지 — 양쪽 모두.** `foo.bak.20260711`, `foo (1)`, `foo~` 같은 잔여 복사본을 잡습니다. Claude Code에서는 Tier 2(이동·복원 가능), Codex에서는 보고만 합니다. 이름 전체가 아니라 **아티팩트 형태**만 매칭하므로 `backup-manager`, `test-engineer` 같은 정상 스킬은 건드리지 않습니다.

테스트: 279 → **347 (+68)**.

이전 릴리스 노트는 [CHANGELOG.md](../CHANGELOG.md)를 참고하세요.

---

## 요구사항

- Node.js 20+
- macOS 또는 Linux
- Claude Code CLI

## 라이선스

MIT
