# ocr-review · Vibe 之后让 AI 自己审一遍代码

> **它做什么用**：vibe coding / AI 写完代码之后，自动整理出「要审哪些文件 + 该套什么规则」的简报，再由 AI agent 读代码自己审一遍，抓逻辑 bug、安全漏洞、遗留坑点。**不调任何外部模型，不烧 API key，离线可用。**

---

## 为什么不让 ocr 自己调模型

[OpenCode Review](https://www.npmjs.com/package/@alibaba-group/open-code-review)（ocr，阿里开源）本身能接模型直接出审查结论。但那要配模型端点、key 会过期、还得多花一次调用费。

本 skill 走 ocr 的 `delegate` 模式：**ocr 只做确定性编排**（选文件 → 分组 → 按文件特征解规则），**审查判断交给 agent 自己做**。agent 本来就是 LLM，读代码 + 读规则直接审，零成本、更可控、不会因为 key 失效而中断。

## 安装

依赖：Node 18+、git。

```bash
npm i -g @alibaba-group/open-code-review
```

本 skill 无需安装，整个目录拷进你的 skills 目录即可：

```bash
~/.workbuddy/skills/ocr-review/     # WorkBuddy 用户级目录
```

> 不需要配置任何模型端点、不需要任何 API key。

## 用法

在目标 git 仓库根目录执行：

```bash
node ~/.workbuddy/skills/ocr-review/scripts/ocr_brief.mjs         # 人读（默认）
node ~/.workbuddy/skills/ocr-review/scripts/ocr_brief.mjs --json  # 机读
```

或者直接让 agent 调这个 skill（触发词：**审一遍 / code review / vibe 完检查一下 / 帮我看看这段代码**）。

脚本会做四件事：定位 ocr → git 预检 → 取待审文件 + ocr 的审查规则 → 跑补充检查 → 打印简报。
随后 agent 读简报 + 读代码 diff，按「文件 → 严重程度 → 问题 + 证据行号 + 修改建议」产出审查清单。**只报不改**，除非你明确让它改。

## 相对裸用 ocr 的增量：6 项补充检查

| 检查 | 级别 | 说明 |
|---|---|---|
| `secret-key` | **blocking** | sk- / AKIA / gh*_ 等 API key、云凭证明文写进代码 |
| `secret-priv` | **blocking** | 私钥内容（`-----BEGIN ... PRIVATE KEY-----`）进代码 |
| `debug-left` | non-blocking | 遗留调试断点（`pdb.set_trace` / `breakpoint()` / `debugger`） |
| `todo-new` | non-blocking | 新增 TODO / FIXME / XXX / HACK 标记 |
| `no-test` | non-blocking | 源码改了但没有任何测试文件跟着改 |
| `big-diff` | non-blocking | 单次新增行 > 400，建议分批审以保精度 |

> ocr 自带的安全规则盯的是 `eval` / `exec` / `subprocess(shell=True)` / `pickle` 这类**代码执行**风险，**并不查凭据泄露**——上面两条 blocking 补的就是这个洞。
>
> ⚠️ 命中密钥请**立刻吊销该凭证**。只删代码不算完，git 历史里还在。

补充检查只扫**新增行**（`git diff HEAD` + 未跟踪文件），历史遗留问题不会误报。

## 许可

- 本 skill（`SKILL.md` + `scripts/`）：**MIT**
- 被包装的 OpenCode Review：`@alibaba-group/open-code-review`，**Apache-2.0**，Alibaba Group

本 skill 仅调用 ocr，**不包含、不修改、不分发其代码**。本项目与 Alibaba Group 无任何 affiliation、sponsorship 或 endorsement。

---

## 联系 / 合作

想做「**Vibe 项目上线前体检**」这类人工交付（审完出人话报告：会崩在哪、为什么、怎么改），或想聊 AI 一人公司 / OPC / 副业自媒体：

**微信号：sheshouzuo3366**

---

## English

An agent-side skill that wraps OpenCode Review's `delegate` mode. ocr does the deterministic orchestration (file selection + rule resolution); the **agent itself** reads the code and performs the review. No external LLM, no API key required.

It adds 6 checks ocr's own rules don't cover: leaked API keys / private keys (blocking), leftover debug breakpoints, new TODO/FIXME markers, source changes without test changes, and oversized diffs.

License: MIT. Wraps `@alibaba-group/open-code-review` (Apache-2.0, Alibaba Group) — no affiliation.
