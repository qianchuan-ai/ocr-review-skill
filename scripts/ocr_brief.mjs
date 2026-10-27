#!/usr/bin/env node
/**
 * ocr_brief.mjs — 为「agent 自审」准备简报包
 *
 * 全程不调用任何 LLM、不消耗 API key。做四件事：
 *   1. portable 定位 ocr（不硬编码机器路径）
 *   2. git 预检
 *   3. 取待审文件 + 审查规则（来自 ocr delegate，确定性编排）
 *   4. 跑 ocr 不覆盖的补充检查（本 skill 的增量价值）
 *   5. 输出简报，交给 agent 读代码自审
 *
 * 用法： node scripts/ocr_brief.mjs [--json]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const IS_WIN = process.platform === 'win32';
const cwd = process.cwd();

const run = (cmd, args, shell = false) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, shell });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
};

/* ── 1. portable 定位 ocr ───────────────────────────────────── */
function resolveOcr() {
  if (run(IS_WIN ? 'where' : 'which', ['ocr']).ok) {
    return { cmd: 'ocr', prefix: [] };
  }
  const npm = run('npm', ['root', '-g'], IS_WIN); // Windows 下 npm 是 .cmd，需 shell
  if (npm.ok) {
    const root = npm.out.trim().split(/\r?\n/).filter(Boolean).pop().trim();
    const bin = join(root, '@alibaba-group', 'open-code-review', 'bin', 'ocr.js');
    if (existsSync(bin)) return { cmd: process.execPath, prefix: [bin] };
  }
  return null;
}

const ocr = resolveOcr();
if (!ocr) {
  console.error('[preflight] 未找到 ocr。请先安装： npm i -g @alibaba-group/open-code-review');
  process.exit(2);
}
const ocrRun = (args) => run(ocr.cmd, [...ocr.prefix, ...args]);

/* ── 2. git 预检 ────────────────────────────────────────────── */
if (!run('git', ['rev-parse', '--is-inside-work-tree']).ok) {
  console.error('[preflight] 当前目录不是 git 仓库，ocr 依赖 git 上下文。请先 cd 进仓库根目录。');
  process.exit(2);
}

/* ── 3. ocr 的确定性编排：待审文件 + 规则（不调 LLM） ──────────── */
const preview = ocrRun(['delegate', 'preview']).out;
const files = [...preview.matchAll(/`([^`]+)`\s*\[/g)].map((m) => m[1]);
const rules = files.length
  ? ocrRun(['delegate', 'rule', ...files]).out
  : '(无待审文件)';

/* ── 4. 补充检查：ocr 规则里没有、但 vibe 代码常踩的坑 ──────────── */
function addedLines() {
  const diff = run('git', ['diff', 'HEAD', '-U0']).out;
  const out = diff
    .split(/\r?\n/)
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard']).out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const f of untracked) {
    try { out.push(...readFileSync(join(cwd, f), 'utf8').split(/\r?\n/)); } catch { /* 忽略不可读文件 */ }
  }
  return out;
}

const CHECKS = [
  { id: 'secret-key',  level: 'blocking',     msg: '疑似 API key / 云凭证明文写入代码',
    re: /sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}/ },
  { id: 'secret-priv', level: 'blocking',     msg: '私钥内容写入代码',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'debug-left',  level: 'non-blocking', msg: '遗留调试断点',
    re: /\b(pdb\.set_trace|breakpoint\(\)|debugger)\b/ },
  { id: 'todo-new',    level: 'non-blocking', msg: '新增 TODO / FIXME / XXX 标记',
    re: /\b(TODO|FIXME|XXX|HACK)\b/ },
];

const lines = addedLines();
const extras = [];
for (const c of CHECKS) {
  const hit = lines.filter((l) => c.re.test(l));
  if (hit.length) {
    extras.push({ ...c, count: hit.length, sample: hit[0].trim().slice(0, 120) });
  }
}

const isSrc = (f) => /\.(py|js|ts|tsx|jsx|go|java|rb|php|c|cpp)$/i.test(f);
const isTest = (f) => /(^|\/)(tests?|__tests__)\/|(_test\.|\.test\.|\.spec\.|test_)/i.test(f);
if (files.some(isSrc) && !files.some(isTest)) {
  extras.push({ id: 'no-test', level: 'non-blocking', count: 1,
    msg: '源码改动未伴随测试变更（按项目约定判断是否需补测）', sample: '' });
}
if (lines.length > 400) {
  extras.push({ id: 'big-diff', level: 'non-blocking', count: lines.length,
    msg: '改动量偏大，建议分批审以保精度', sample: '' });
}

/* ── 5. 输出简报 ────────────────────────────────────────────── */
const brief = {
  repo: cwd,
  ocr_entry: ocr.prefix.length ? `node ${ocr.prefix[0]}` : 'ocr (PATH)',
  added_line_count: lines.length,
  files,
  extra_findings: extras,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ...brief, rules }, null, 2));
} else {
  console.log(`# ocr 自审简报 · ${cwd}\n`);
  console.log(`ocr 入口：${brief.ocr_entry}   新增行：${lines.length}\n`);
  console.log(`## 待审文件（${files.length}）`);
  files.forEach((f) => console.log(`- ${f}`));
  console.log('\n## 补充检查（ocr 不覆盖 · 本 skill 增量）');
  if (!extras.length) console.log('- 无');
  else extras.forEach((e) => {
    console.log(`- [${e.level}] ${e.msg}${e.count > 1 ? ` ×${e.count}` : ''}`);
    if (e.sample) console.log(`    > ${e.sample}`);
  });
  console.log(`\n## 审查规则（来自 ocr delegate）\n\n${rules}`);
}
