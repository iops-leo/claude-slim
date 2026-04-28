<div align="center">

# claude-slim

**你的Claude Code在你说"你好"之前就已经在烧token了。**

每次会话启动时，所有技能、记忆文件和插件指令都会加载到系统提示词中 — 包括你从未使用过的。claude-slim找到并消除这些浪费。

[English](../README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md)

</div>

---

### 问题可视化

```
  会话启动时的token预算
  ┌──────────────────────────────────────────────────┐
  │██████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░│ claude-slim之前
  │ 12K tokens消耗 ↑         实际工作 ↑              │
  ├──────────────────────────────────────────────────┤
  │██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ claude-slim之后
  │ 5K ↑               工作空间扩大 ↑               │
  └──────────────────────────────────────────────────┘
```

开销藏在哪里：

| 来源 | 典型开销 |
|------|:---:|
| 60+已注册技能 | ~3,000 tokens |
| CLAUDE.md（插件指令） | ~5,000 tokens |
| 记忆文件 | ~2,500 tokens |
| Deferred tools列表 | ~1,500 tokens |
| **合计** | **~12,000 tokens** |

---

## 一条命令。五个步骤。

```
/claude-slim
```

```
 ┌────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌────────┐
 │  Scan  │ → │ Analyze │ → │ Propose │ → │ Execute │ → │ Report │
 │        │   │         │   │         │   │         │   │        │
 │ 测量   │   │ 断开    │   │ 用户    │   │.disabled│   │before  │
 │ 所有   │   │ 重复    │   │ 选择    │   │  移动   │   │  vs    │
 │ 来源   │   │ 膨胀    │   │ 内容    │   │  至     │   │ after  │
 └────────┘   └─────────┘   └─────────┘   └─────────┘   └────────┘
```

**Scan** — 测量一切：本地技能、插件技能、CLAUDE.md、记忆文件、MCP服务器。

**Analyze** — 自动发现浪费：

| | 检测对象 |
|---|---|
| 断开的符号链接 | 卸载技能包后残留的死链 |
| 重复技能 | 同一技能从多个来源注册 |
| 空模板 | 没有内容的占位技能 |
| 超大文件 | 超过10KB的SKILL.md |
| **未使用技能** | **最近 N 天（默认 60 天）会话中从未被调用过的本地技能** |
| 过期记忆 | 每次会话加载的大型记忆文件 |

**Propose** — 三级分类，你来决定：

| 级别 | 操作 | 示例 |
|------|------|------|
| **Auto** | 预选 | 断开的链接、空模板 |
| **Recommended** | 建议 | 重复项、过期记忆 |
| **Optional** | 用户判断 | 可能还会用的大型技能 |

**Execute** — 将选中项移至 `~/.claude/skills.disabled/`。不会删除任何文件。

**Report** — 精确展示变化：

```
┌────────────────┬──────────┬──────────┬────────────┐
│                │  Before  │  After   │  节省      │
├────────────────┼──────────┼──────────┼────────────┤
│ 本地技能       │    65    │    15    │  -50       │
│ 系统提示词     │   ~80    │   ~48    │  -32       │
│ 记忆文件       │   15KB   │    2KB   │  -13KB     │
│ 预估tokens    │  ~8,500  │  ~4,200  │  ~4,300    │
└────────────────┴──────────┴──────────┴────────────┘
```

---

## 安装

```bash
claude plugin marketplace add iops-leo/claude-slim
claude plugin install claude-slim
```

## 使用方法

```bash
/claude-slim              # 完整流水线
/claude-slim scan         # 仅报告，不做更改
/claude-slim restore      # 全部恢复
```

---

## 安全第一

| | |
|---|---|
| **非破坏性** | 不删除任何东西。禁用项移至 `~/.claude/skills.disabled/` |
| **可恢复** | `/claude-slim restore` 随时恢复 |
| **用户可控** | 更改前始终确认 |
| **不触碰危险区** | 绝不修改CLAUDE.md、settings.json或插件配置 |

---

## 工作原理

claude-slim扫描以下位置。无插件特定逻辑 — 纯文件系统分析。

```
~/.claude/
├── skills/                  ← 用户安装的技能
├── plugins/cache/           ← 插件技能
├── CLAUDE.md                ← 插件指令（只读）
├── projects/*/memory/       ← 自动记忆文件
└── settings.json            ← MCP服务器数量（只读）
```

适用于任何插件组合：OMC、gstack、自定义技能、市场插件，或什么都没有。

---

## 实际效果

来自数月积累技能的真实清理会话：

| 指标 | Before | After | |
|------|:------:|:-----:|---|
| 本地技能 | 65 | 15 | **-77%** |
| 系统提示词技能 | ~80 | ~48 | **-40%** |
| 记忆文件 | 15KB | 2KB | **-87%** |
| **预估token节省** | | **~4,300/会话** | |

---

## v2.4 更新

- **未使用技能检测** — 读取 `~/.claude/projects/*/*.jsonl` 会话记录，找出最近 60 天内从未被 `Skill` 工具调用过的本地技能并标记。归为 Tier 3（Optional，默认不选中），由用户自行决定。可通过 `--lookback-days <n>` 调整窗口。会话数不足 3 个或一次调用都没有（可能是 schema 变更）时整体抑制分类，避免在数据不可靠时产生错误信号。
- **插件技能被特意排除**。`~/.claude/plugins/cache/` 下的技能由 Claude Code 插件运行时管理，移动文件会让插件处于部分卸载状态。插件级清理请用 `claude plugin disable <name>`。
- **会话使用缓存** — 保存在 `~/.claude/.skill-usage-cache.json`，按 mtime 索引。热扫描只会重新解析有变更的会话日志。
- **Node 20+** 成为新的引擎最低版本（此前为 `>=18`，但 Node 18 已在 v2.3.0 时从 CI matrix 中移除）。

## v2.3 更新

- **detector 注册表重构 (v2.3.0)** — 将 588 行的单体扫描模块拆分为 `src/scanner/` 下的细粒度 detector。新增启发式规则只需新增一个函数（详见 CONTRIBUTING.md）。公共 API 保持不变。
- **路径封锁守卫 (v2.2.3)** — 所有破坏性操作都会拒绝逃出 `~/.claude/` 的目标路径。`runCommand` 不再经过 shell。`temp_cache` 清理是 symlink-safe 的。
- **报告符号修正 (v2.2.3)** — 修复 2.2.x 早期分解表 Saved 列符号反转的 bug,现在每行显示正确的节省量。
- **85 项测试（此前 73）** — 新增路径封锁、restore 守卫、分解表符号、restore-selection 去重、token 缓存原子 flush、自定义 detector 注入等 round-trip 测试。

## v2.2 更新

- **`stale_project` 的原子化 clean/restore** — 用单次目录 `rename()` 代替按文件循环。即使中途中断，也不会出现文件分散在源目录与备份目录的"部分失败"状态。
- **清晰的冲突错误提示** — 对已有备份的项目再次 clean，或把 restore 目标写到已有目录上时，会给出可操作的错误信息，而不是晦涩的 OS 错误。
- **清单 schema v2** — 仅包含当前被禁用条目的单一 JSON 文件（`manifest.json`）。restore 会直接移除该条目,多次 clean/restore 循环后文件大小不会无限增长。
- **v1 自动迁移** — 已有的旧清单(`.claude-slim-manifest.jsonl`)会在首次读取时自动转换为 v2;原文件以 `.jsonl.bak` 保留。
- **崩溃安全写入** — 采用"写临时文件后原子重命名"模式;停电或 SIGKILL 都不会破坏清单文件。
- **测试覆盖扩展** — 66 项测试(此前 35)。为每种 issue 类型新增 round-trip 测试:`broken_symlink`、`template`、`duplicate`、`skill_dup`、`oversized_skill`、`temp_cache`、`stale_project`。另含清单迁移与 bounded-growth 循环测试。

---

## 要求

- Node.js 20+
- macOS 或 Linux
- Claude Code CLI

## 许可证

MIT
