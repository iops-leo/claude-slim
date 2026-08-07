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

## v2.12.2 更新 (2026-08-07)

- **修复：`--project-dir` 拼写错误会自信地报告 0。** 2.12.1 为消除静默的 0 而加入的参数，自身又制造了同样的问题。slug 只是路径字符串的纯粹变换，因此拼错的路径同样会得到一个格式完好的 slug，与任何项目都不匹配，并以退出码 0 结束。现在这会报错。真实存在但没有记忆的目录仍是真正的 0，依旧静默通过。
- **修复：只有 `report` 忽略了项目范围。** 它是唯一既不接受 `--project-dir`、也不会在安装目录下发出警告的命令，因此其前后对比可能基于与所清理项目不同的项目计算。
- **修复：成功的清理被报告为失败。** 一个技能会同时命中多条问题，选择 `all` 时会反复移动同一个目录：第一次成功，其余则显示原始的 `ENOENT`。在发现该问题的机器上产生了 15 条虚假错误。
- **修复：`1-20` 只选中了一项。** 现在会解析范围，无法理解的输入也会明确指出被忽略的内容，而不是悄悄丢弃。
- **修复：报告框的边线比正文宽出两列。**
- **新增 `recoverableStartupTokens`** — 处理全部问题后在启动时真正能收回的量。每条问题的 `tokens` 是仅在技能运行时才产生的 `SKILL.md` 完整体积，直接相加会得出 **在启动总量为 13,434 tokens 的环境中节省 215,535 tokens** 的结论。技能现在报告诚实的数字。
- **新增 `currentProjectKnown`** — 使 `--json` 能够区分实测的 0 与归属失败的 0。

测试: 401 → **438 (+37)**。

历史发布说明请参阅 [CHANGELOG.md](../CHANGELOG.md)。

---

## 要求

- Node.js 20+
- macOS 或 Linux
- Claude Code CLI

## 许可证

MIT
