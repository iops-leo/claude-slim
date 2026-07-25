<div align="center">

# claude-slim

**你的Claude Code在你说"你好"之前就已经在烧token了。**

每次会话启动时，所有技能、代理、斜杠命令、记忆文件和插件指令都会加载到系统提示词中 — 包括你从未使用过的，而且每一轮对话都要为此付费。claude-slim测量这部分启动开销，并清除你不需要的部分。

不用代理，不做压缩，也不改变Claude Code与API的通信方式 — 它只读取`~/.claude/`，告诉你每个技能和插件的真实成本，然后以可恢复的方式移走那些无用负担。

[English](../README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md)

</div>

---

### 实际运行效果

<p align="center">
  <img src="demo.gif" alt="claude-slim cleanup demo" width="900" />
</p>

开销藏在哪里 — 基于一台真实机器的实测值：

| 来源 | 成本 | |
|------|:---:|---|
| 技能列表 | ~10,100 tokens | 256个技能 × 各自的`名称: 描述`一行 |
| 代理目录 | ~2,250 tokens | `~/.claude/agents/`，12个 |
| CLAUDE.md | ~2,000 tokens | 插件指令 |
| Deferred tools列表 | ~1,500 tokens | MCP工具schema |
| 斜杠命令 | ~80 tokens | `~/.claude/commands/` |
| 记忆文件 | **0 ~ 63,500 tokens** | 仅当前项目 — 各项目差异极大 |

最容易被低估的是技能列表。每个已安装的技能都会向系统提示词添加一行`- 名称: 描述`，而这一行的成本从**30 tokens到509 tokens不等**。同样是60个技能，账单并不相同。

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
| 代理与命令 | `~/.claude/agents/` 和 `~/.claude/commands/` — 仅测量与报告，绝不修改 |
| 过期记忆 | 每次会话加载的大型记忆文件 |

**Propose** — 三级分类，你来决定：

| 级别 | 操作 | 示例 |
|------|------|------|
| **Auto** | 预选 | 断开的链接、空模板 |
| **Recommended** | 建议 | 重复项、过期记忆 |
| **Optional** | 用户判断 | 可能还会用的大型技能 |

**Execute** — 将选中的技能和项目记忆移至 `~/.claude/skills.disabled/`。失败安装的临时缓存和断开的 symlink 文件是唯一的永久清理项，并会在选择前标记为 permanent。

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
/claude-slim doctor       # 检查扫描前提和会话日志信号质量
/claude-slim check-update # 检查是否有更新版本
/claude-slim restore      # 全部恢复
```

---

## 安全第一

| | |
|---|---|
| **不破坏用户数据** | 技能和项目记忆移至 `~/.claude/skills.disabled/` |
| **可恢复** | 已移动的技能和项目记忆可通过 `/claude-slim restore` 恢复 |
| **用户可控** | 交互式运行会在更改前确认。`--dry-run` 可预览，`--auto` 只选择 Tier 1 |
| **不触碰危险区** | 绝不修改CLAUDE.md、settings.json、插件配置、`~/.claude/agents/`、`~/.claude/commands/` |
| **路径封闭** | 目标路径一旦超出 `~/.claude/`，所有破坏性操作一律拒绝 |

---

## 工作原理

claude-slim扫描以下位置。无插件特定逻辑 — 纯文件系统分析。

```
~/.claude/
├── skills/                  ← 用户安装的技能
├── plugins/cache/           ← 插件的技能、代理、命令、MCP服务器
├── agents/                  ← 用户代理（仅测量，只读）
├── commands/                ← 用户斜杠命令（仅测量，只读）
├── CLAUDE.md                ← 插件指令（只读）
├── projects/*/memory/       ← 自动记忆文件（仅当前项目计入启动开销）
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

### 关于这些数字

claude-slim 报告的是**在当前目录**开启会话所需的成本。记忆是按项目划分的 — Claude Code 只加载当前项目的 `~/.claude/projects/<slug>/memory/`，不会加载磁盘上的其他项目。因此在两个不同仓库中运行 `scan` 得到不同的总量，属于正常现象。

token 数量由 [js-tiktoken](https://github.com/nicolo-ribaudo/js-tiktoken) 对文件实际内容计算得出。仅剩两项仍为估算值，均以 `~` 标注：MCP 工具 schema（每个工具约 8 tokens），以及 frontmatter 无法解析的技能（约 30 tokens）。其余全部为实测值。

---

## v2.9.0 更新 (2026-07-25)

版本滞后检测。起因是发现了一个**在 2.8.1 已发布的情况下仍在运行 2.0.0 的真实安装** — 落后八个版本，而工具和插件系统都没有作出任何提示。由于 2.8.0 之前的版本会把启动 token 估算夸大约 8 倍，使用旧版本并不只是缺少功能，而是**把错误的数字当作事实接收**。

- **新增 `claude-slim check-update`** — 检查是否有更新版本，并根据**这份副本的实际安装方式**（插件 / 全局 npm / npx / 源码）给出对应的升级命令。
- **`doctor` 新增版本检查** — 以与其他检查项相同的形式展示。使用 `doctor --offline` 可跳过。
- **技能新增版本闸门** — 执行 `/claude-slim` 时会在扫描前检查；若版本过旧，会先说明你将看到什么样的数字，再询问是否先更新。同时明确提示**插件更新需要重启会话才会生效**（否则更新后重新运行仍得到相同数字，令人困惑）。
- **修正 SECURITY.md 中"无网络访问"的表述** — 该保证在本次发布之前是准确的。现在 `scan`、`clean`、`restore`、`report` 仍然不发起任何请求，唯一的例外是 `doctor` 与 `check-update` 的版本检查。它不发送任何用户信息，2.5 秒超时，失败时静默继续，缓存 24 小时，并可用 `--offline` 完全跳过。

**不会自我更新。** 更新是包管理器的职责，工具若直接写入插件管理器所拥有的目录，安装就会被破坏。本次发布只做检测与提示。

测试: 241 → **266 (+25)**。

---

## v2.8.0 更新 (2026-07-25)

精度修正版本。此前报告的数字中有三个是错的，其中最大的一个错了一个数量级。**如果升级后启动token估算值大幅下降，那么错的是旧数字。**

- **启动token估算不再累加磁盘上所有项目的记忆文件。** Claude Code只加载当前项目的`memory/`，而旧版本把所有项目都加了进去。也就是说，一个名为"tokens at session start"的数值，会随着你打开过的项目数量而膨胀。在开发机器上，**报告值为116,259 tokens，而真实的单次会话成本是14,399**。现在该估算已限定为当前项目，跨项目总计仍会显示，但明确标注为"非单次会话成本"。
- **技能列表成本改为实测，不再使用常量。** 每个技能都会向系统提示词添加一行`- 名称: 描述`，旧版本一律按固定值30 tokens计算。对68个已安装技能的实测分布为**30~509 tokens（均值51）** — 总量上低估了70%。v2.7.0的插件成本梯度此前无法区分"5个描述冗长的技能"和"5个描述简短的技能"，此问题一并解决。
- **新增`~/.claude/agents/`和`~/.claude/commands/`扫描。** 它们会进入每次会话的系统提示词，却完全不在扫描范围内（开发机器上为12个代理，约2,254 tokens）。**仅测量与报告** — 不移动、不删除。在没有恢复路径的情况下加入破坏性操作，会破坏这个工具的核心承诺。
- **修复插件清单版本停滞。** `.claude-plugin/*`连续三个版本停留在2.7.0。`claude plugin install`读取的是清单而非`package.json`，因此插件用户一直看到旧版本号。现由CI检查（`npm run check:versions`）防止复发。
- **修复token缓存无限增长。** 开发机器上776条记录中有355条（46%，139KB）指向已删除的文件。

测试: 206 → **241 (+35)**。

---

## v2.7 更新

- **未使用插件检测** — 从会话记录中同时解析 MCP 工具调用(`mcp__plugin_<插件>_<服务器>__*`)与斜杠命令,标记出最近 60 天内技能、MCP、命令都未被调用过的插件。归为 Tier 3(Optional,默认不选中),由用户自行判断。清理时会自动执行 `claude plugin disable <name>`,可通过 `/claude-slim restore` 恢复。
- **PLUGIN BREAKDOWN 表格** — 扫描报告新增按插件划分的 token 明细(CLAUDE.md 章节 + 技能注册 + MCP deferred 工具 + 命令)与使用状态(used / unused / agent-only / insufficient data / disabled)。真实环境头部示例:`oh-my-claudecode` ~6,210 tok,`pm-skills` 系列合计 ~2,500 tok。
- **会话解析器 Bug 修复** — 字符串形式的用户消息(直接使用的斜杠命令)以往会被跳过,现在字符串与数组两种内容形态都能正确统计。
- **新增 +82 项测试**(新模块与解析器回归)。

## v2.7.1 (2026-07-20)

- **修复 `unused_plugin` 节省量始终为 0 的问题** — 检测器未能使用已计算好的插件成本,导致 dry-run 与报告低估了节省量。`pluginCosts` 映射现已接入 DetectorContext,使用真实值。
- **修复 `duplicate` 检测器的命名空间误报** — 带命名空间的本地技能(如 `org/ship`)会被错误标记为插件同名 `ship` 的重复。现在只有完全一致的名称才判定为重复。
- **加强 `stale_project` 恢复的路径范围** — 通过按类型划分的子树守卫,阻断被篡改的清单把项目内存备份重定向到技能目录的攻击面。
- **非交互式 shell 中若未附带 `--auto`/`--dry-run`,`clean` 会被拒绝** — 之前会默默应用 Tier 1,现在会给出警告并以 exit 1 结束,要求用户显式 opt-in。
- **正确处理 `--lookback-days 0` 与 `--sessions-per-day 0`** — 修复 `parseInt() || N` 把显式的 0 升级为默认值的问题。
- **`claude-slim report` 现在也会展示仅包含 zero-token 清理(broken_symlink / temp_cache)的历史记录**。

## v2.6 更新

- **`claude-slim doctor`** — 检查 Node 支持、`~/.claude/` 可读性、本地技能/插件缓存、`claude plugin list` 以及近期会话日志信号质量。适合在扫描结果过少或未使用技能检测被抑制时诊断原因。
- **更准确的安全说明** — 技能和项目记忆会移动到 `~/.claude/skills.disabled/`，可恢复；断开的 symlink 文件和失败安装的 `temp_local_*` 缓存会作为 permanent 清理目标标记。
- **固定开发 Node 版本** — `.nvmrc` 和 `.node-version` 固定为 Node 22.12.0，以匹配当前 Vitest/Vite/Rolldown 的 patch-floor 要求。

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
