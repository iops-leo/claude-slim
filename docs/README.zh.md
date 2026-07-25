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

```mermaid
flowchart LR
    A["<b>Scan</b><br/>测量所有来源"] --> B["<b>Analyze</b><br/>断开 · 重复 · 膨胀"]
    B --> C["<b>Propose</b><br/>用户选择"]
    C --> D["<b>Execute</b><br/>移至 .disabled"]
    D --> E["<b>Report</b><br/>before vs after"]
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

| | Before | After | 节省 |
|---|:---:|:---:|:---:|
| 本地技能 | 65 | 15 | -50 |
| 系统提示词 | ~80 | ~48 | -32 |
| 记忆文件 | 15KB | 2KB | -13KB |
| 预估 tokens | ~8,500 | ~4,200 | ~4,300 |

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

历史发布说明请参阅 [CHANGELOG.md](../CHANGELOG.md)。

---

## 要求

- Node.js 20+
- macOS 或 Linux
- Claude Code CLI

## 许可证

MIT
