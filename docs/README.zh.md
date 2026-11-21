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

开销藏在哪里 — 一次真实会话开始时 Claude Code 实际发送的内容，从它自己的会话日志中读回：

| 来源 | 成本 | |
|------|:---:|---|
| MCP工具名称 | ~10,700 tokens | 768个名称。工具搜索延迟加载的是schema，不是名称 — 仅一个连接器就列出了160个 |
| 技能列表 | ~8,200 tokens | 213个技能，上限为上下文窗口的1% — **其中99个只显示名称** |
| 指令文件 | ~6,300 tokens | CLAUDE.md、`@path` 导入、无 `paths:` 的规则、项目的 `MEMORY.md` |
| MCP服务器指令 | ~3,600 tokens | 10个服务器，含 claude.ai 连接器 |
| 代理目录 | ~2,200 tokens | 33个代理 |

技能列表是有预算的：上下文窗口的1%（200k 模型为 6,000 个字符，1M 为 30,000 个字符）。超出之后，Claude Code 不会让提示词变长，而是从最少使用的技能开始，悄悄删掉它们的描述。这些技能仍然已安装、仍然可以调用，但模型只能看到 `- skill-name`，无从判断什么时候该用。在上面这台机器上，将近一半的技能处于这种状态。

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
| **未使用 MCP 服务器** | **`~/.claude.json` 中 user／local 作用域、最近 N 天内工具从未被调用过的服务器。Tier 3，不会自动选中。通过 `claude mcp remove` 删除，定义保留以便 `restore`。** |
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
| **可恢复** | 已移动的技能、项目记忆和已删除的 MCP 服务器可通过 `/claude-slim restore` 恢复 |
| **用户可控** | 交互式运行会在更改前确认。`--dry-run` 可预览，`--auto` 只选择 Tier 1 |
| **不触碰危险区** | 绝不修改CLAUDE.md、settings.json、插件配置、`~/.claude/agents/`、`~/.claude/commands/` |
| **路径封闭** | 目标路径一旦超出 `~/.claude/`，所有破坏性操作一律拒绝 |
| **MCP 只经由 Claude Code** | 从不直接编辑 `~/.claude.json`。选中的 MCP 服务器用 `claude mcp remove` 删除，定义以 0600 权限备份到 `~/.claude/skills.disabled/.mcp-backup/` |
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
├── projects/*/*.jsonl       ← 会话日志：你调用了什么，以及最新会话加载了什么（只读）
└── settings.json            ← 设置（只读；在此定义的 MCP 服务器会标为未加载）
~/.claude.json               ← user／local 作用域 MCP 服务器
<project>/.mcp.json          ← project 作用域 MCP 服务器（只读）
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

**MEASURED AT SESSION START** 更进一步：它读取 Claude Code 记录在最新会话日志中的启动上下文，因此能覆盖磁盘分析看不到的部分 — claude.ai 连接器、MCP 工具名称，以及哪些技能被削减到只剩名称。技能列表超出预算时，估算值按预算计入，`RECOVERABLE` 也会如实说明：从超出预算的列表中删除技能，换回的是被删掉的描述，而不是更短的提示词。

---

## v2.17.0 更新 (2026-11-22)

- **新增：MEASURED AT SESSION START。** `scan` 读取 Claude Code 记录在最新会话日志中的启动上下文 — 技能列表、MCP 工具名称、服务器指令、代理目录、指令文件 — 并报告：
  - **只显示名称的技能。** 技能列表的上限是上下文窗口的 1%；超出后，最少使用的技能会被去掉描述。这些技能按插件分组列出，并显示清理掉未使用的技能能换回多少条描述。
  - **同一个连接器被添加了两次** — 两个 MCP 服务器暴露相同的工具名称（例如一个 claude.ai 连接器加一个手动安装），以及两个服务器都暴露的工具名称。
  - 首轮的真实输入大小，包含 Claude Code 自身的提示词。
- **变更：估算值遵循列表预算。** 超出预算的技能列表按预算计入，`RECOVERABLE` 也不再承诺那些删除技能也释放不了的 token。
- **修复：未使用检测。** 以 `/name` 输入调用的技能，以及只通过 `/plugin:command` 使用的插件，之前会被报告为未使用。现在 Claude Code 自己的 `skillUsage` 记录也算作使用。"60 天内未调用"的说法超出了日志实际能支撑的范围 — Claude Code 默认会删除 30 天前的日志 — 因此现在每条结果都会注明依据了多少天的日志，`doctor` 也会告诉你如何保留更久。
- **修复：恢复与安全。** 恢复 Codex 技能时，可能丢掉同名 Claude 技能的记录。损坏的 `manifest.json` 会被静默覆盖。`skills/` 下的符号链接文件夹可能让 clean 把 `~/.claude/` 之外的文件移走。这三个问题均已修复。
- 其他修复：活跃项目被当作过期项目建议清理、插件状态按市场而非按插件判断、没有 TTY 时 `clean --dry-run` 拒绝运行、使用 `--project-dir` 时清理后的数值虚高、`CODEX_HOME` 被忽略。

测试: 580 → **703**。

历史发布说明请参阅 [CHANGELOG.md](../CHANGELOG.md)。

---

## 要求

- Node.js 20+
- macOS 或 Linux
- Claude Code CLI

## 许可证

MIT
