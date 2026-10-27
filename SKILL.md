---
name: ocr-review
description: Vibe coding 之后对代码做 AI 审查。当完成一段代码生成/修改（vibe、agent 写码、手动改码）后，用 OpenCodeReview (ocr) 做审查编排，由 agent 自己读代码 + 规则产出审查意见，抓逻辑 bug、安全漏洞、设计问题。触发词：审一遍、代码审查、code review、run ocr、vibe 完检查一下、review my code、帮我看看这段代码。无需外部 API / 模型 key。
---

# OpenCode Review（ocr）— Vibe 后 agent 自审

## 核心思路
- ocr 是阿里开源的 AI 代码审查 CLI，做**确定性编排**：选文件 → 分组 → 按文件特征解规则。
- 本 skill 走 `ocr delegate` 模式：**ocr 只产出「待审文件清单 + 解出的审查规则」，审查判断由 agent（你）自己做**。不调任何外部 LLM、不烧 API key、零成本、离线可用。
- 为什么不让 ocr 自己调模型：① 免 API key / 免 token 过期；② agent 本身就是 LLM，读代码+规则直接审，token 更省、更可控；③ `ocr review` / `ocr scan` 是可选补充，但依赖外部模型端点。

## 前置
- 安装：`npm i -g @alibaba-group/open-code-review`（Apache-2.0，v1.13.3 实测通过）。
- **不要硬编码 ocr 路径**——npm 装完未必建 PATH 软链，且各机器全局目录不同。统一用本 skill 自带的 `scripts/ocr_brief.mjs` 自动定位（`ocr` 命令 → `npm root -g` 解析，两级回退）。
- 运行前 **`cd` 进目标 git 仓库根目录**（ocr 依赖 git 上下文）。

## 标准工作流（每次 vibe 后）
1. **生成简报包**（一键，不调模型）：
   `node <skill目录>/scripts/ocr_brief.mjs`
   - 它干四件事：定位 ocr → git 预检 → 取待审文件 + ocr 的审查规则 → 跑**补充检查** → 打印简报。
   - 机器读用：`node ... --json`
2. **agent 自审**：读简报 + 读这些文件的 git diff / 当前内容，套用规则，产出审查清单：
   - 按 **文件 → 严重程度（blocking / 非 blocking）→ 问题 + 证据行号 + 修改建议** 组织。
   - **只报不改**，除非用户明确让改。

## 补充检查：ocr 规则不覆盖、但 vibe 代码常踩的坑
这是本 skill 相对裸用 ocr 的增量价值（脚本自动跑，命中即进简报）：

| 检查 | 级别 | 说明 |
|---|---|---|
| `secret-key` | blocking | 疑似 API key / 云凭证（sk-、AKIA、gh*_）明文写进代码 |
| `secret-priv` | blocking | 私钥内容（`-----BEGIN ... PRIVATE KEY-----`）进代码 |
| `debug-left` | non-blocking | 遗留调试断点（`pdb.set_trace` / `breakpoint()` / `debugger`） |
| `todo-new` | non-blocking | 新增 TODO / FIXME / XXX / HACK 标记 |
| `no-test` | non-blocking | 源码改了但没有任何测试文件跟着改 |
| `big-diff` | non-blocking | 单次新增行 > 400，建议分批审以保精度 |

> ocr 自带的安全规则盯的是 `eval` / `exec` / `subprocess(shell=True)` / `pickle` 这类代码执行风险，**不查凭据泄露**；上面两条 blocking 是补这个洞的。

## 常用变体（直连 ocr 时用）
- 分支对比预览：`ocr delegate preview --from master --to dev-ref`
- 整仓扫描文件清单：`ocr scan --preview`（不调 LLM）
- 给业务背景（仅 `ocr review` 模式时用）：`--background "给登录接口加限流"` 或 `--background-file ./docs/requirements.md`
- 排除生成物：`--exclude '**/generated/*,**/testdata/*'`

## 红线
- **默认走 delegate（agent 自审），不依赖任何外部模型端点**。
- 若改用 `ocr review` 接外部模型，只用你自己可控且免费的端点，绝不接付费 / 后付按量通道。
- 审查产出「建议」不是「修改」——除非用户明确让改，否则只报不改。
- 简报里命中的 `secret-*` 要提醒用户**立刻吊销该凭证**，光删代码不算完（git 历史里还在）。

## 可选：接外部模型（ocr review 模式）
如需 ocr 自己调模型出 JSON：`ocr config set custom_providers.<name>.url <openai 兼容端点>` + `protocol openai` + `model`。端点或凭据失效时退回 delegate 模式即可，不影响审查。
