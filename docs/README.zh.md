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
| CLAUDE.md | ~2,000 tokens | 插件指令，含 `@path` 导入 |
| 规则 | ~1,200 tokens | 无 `paths:` 的 `~/.claude/rules/` — 按路径限定的规则稍后加载 |
| Deferred tools列表 | ~1,500 tokens | MCP工具schema |
| 斜杠命令 | ~80 tokens | `~/.claude/commands/` |
| 记忆索引 | **0 ~ 6,500 tokens** | 仅当前项目的 `MEMORY.md`，前 200 行 / 25KB — 主题文件按需读取 |

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
| **未使用插件** | **最近 N 天（默认 60 天）会话中技能／MCP／命令从未被调用过的插件。Tier 3，不会自动选中。** |
| 过大的记忆索引 | 超过 5KB，或在 200 行 / 25KB 启动上限处被截断、尾部永不加载的 `MEMORY.md` |
| 规则 & 导入 | `~/.claude/rules/` 与 CLAUDE.md 的 `@path` 导入 — 仅测量与报告，从不修改 |
| 已禁用插件 | 已安装但处于禁用状态、仍占用缓存 |
| 过期项目 | 90 天以上未触碰的项目记忆 |
| 临时缓存 | 插件安装失败的残留物（`temp_local_*`） |

**Propose** — 三级分类，你来决定：

| 级别 | 操作 | 示例 |
|------|------|------|
| **Auto** | 预选 | 断开的链接、空模板、临时缓存 |
| **Recommended** | 建议 | 重复项、过期记忆、已禁用插件、过期项目 |
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

也可以通过 [skills.sh](https://skills.sh) 目录安装，该方式也能把技能装进 Codex、Cursor 和 OpenCode。
但 claude-slim *分析*的对象不变，仍是 `~/.claude/` 和 `~/.codex/`。

```bash
npx skills add iops-leo/claude-slim
```

## 使用方法

```bash
/claude-slim              # 完整流水线
/claude-slim scan                     # 仅报告，不做更改
/claude-slim scan --project-dir PATH  # 统计 PATH 的项目记忆（默认: cwd）
/claude-slim doctor                   # 检查扫描前提和会话日志信号质量
/claude-slim check-update             # 检查是否有更新版本
/claude-slim restore                  # 全部恢复
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
| **Codex 同规则** | `~/.codex/` 同样按三级清理。移动至 `~/.codex/skills.disabled/`，可通过 `restore` 还原 |
| **代理间隔离** | 路径守卫按代理隔离，Codex 条目无法解析到 `~/.claude/`，反之亦然 |

---

## 工作原理

claude-slim扫描以下位置。无插件特定逻辑 — 纯文件系统分析。

```
~/.claude/
├── skills/                  ← 用户安装的技能
├── plugins/cache/           ← 插件的技能、代理、命令、MCP服务器
├── agents/                  ← 用户代理（仅测量，只读）
├── commands/                ← 用户斜杠命令（仅测量，只读）
├── CLAUDE.md                ← 系统指令 + @导入（只读）
├── rules/                   ← 用户规则（测量，只读；按路径限定的单独列出）
├── projects/*/memory/       ← 自动记忆（仅当前项目的 MEMORY.md 计入启动开销）
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

claude-slim 报告的是**在当前目录**开启会话所需的成本。记忆是按项目划分的 — Claude Code 只加载当前项目的 `~/.claude/projects/<slug>/memory/`，不会加载磁盘上的其他项目。因此在两个不同仓库中运行 `scan` 得到不同的总量，属于正常现象。在该项目内部，启动时也只加载 `MEMORY.md` 的前 200 行或 25KB；主题文件在 Claude 读取之前不产生任何开销。

token 数量由 [js-tiktoken](https://github.com/nicolo-ribaudo/js-tiktoken) 对文件实际内容计算得出。仅剩两项仍为估算值，均以 `~` 标注：MCP 工具 schema（每个工具约 8 tokens），以及 frontmatter 无法解析的技能（约 30 tokens）。其余全部为实测值。

---

## v2.15.0 更新 (2026-09-16)

- **修复：启动开销估算把项目里的所有记忆文件都算了进去，而 Claude Code 启动时只加载 `MEMORY.md`。** 官方文档写得很明确：会话开始时加载的是 `MEMORY.md` 的前 200 行或 25KB，主题文件按需读取。把整个目录相加，让一个有 183 个主题文件的项目被报告为**启动时 ~238,000 tokens**，而会话实际收到的约为 10,000。针对主题文件逐个发出的 `oversized_memory` 警告也因同样原因移除——裁剪它们并不会节省任何上下文。
- **新增：索引截断警告。** 超过 200 行 / 25KB 上限的 `MEMORY.md` 会被静默截断，最新条目永远到不了会话。`scan` 现在会标记它并报告实际送达的 token 数。
- **新增：`~/.claude/rules/`。** 没有 `paths:` 前置元数据的规则在启动时以与 CLAUDE.md 相同的优先级加载；按路径限定的规则只在读取匹配文件时加载。两者都会列出，只有前者计入总量。仅报告，从不移动。
- **新增：CLAUDE.md 的 `@path` 导入。** 以 `@RTK.md` 形式引入的文件会在启动时展开进上下文，最多递归四层。现在会列在 CLAUDE.md 之下并计入总量。

测试: 486 → **529**。

历史发布说明请参阅 [CHANGELOG.md](../CHANGELOG.md)。

---

## 要求

- Node.js 20+
- macOS 或 Linux
- Claude Code CLI

## 许可证

MIT
