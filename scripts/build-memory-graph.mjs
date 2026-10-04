#!/usr/bin/env node
/**
 * build-memory-graph.mjs — 扫描 OpenClaw workspace 生成 memory-graph 快照
 *
 * 用法:
 *   node scripts/build-memory-graph.mjs            # 输出到 public/memory-graph-data.json
 *   node scripts/build-memory-graph.mjs --dry-run  # 只打印统计不写文件
 *
 * 既可作为 CLI 直接运行（用于 `npm run graph:build`），也可被进程内
 * graph-server.ts 动态 import 以做「按 agent 域
 * 增量重建」：只用本模块导出的 DOMAINS / domainSignature / scanDomain /
 * assignIds / computeEdges / assembleData，复用未变化域的已扫描节点，只对变化的域
 * 重新读取文件，从而把上千文件的扫描成本降到「仅变化域」。
 *
 * 数据结构与 public/memory-graph.html 消费端对齐:
 *   { generatedAt, source, agents:[{id,color,count}], stats, nodes:[...], edges:[{s,t,k}] }
 * html 仅使用 evidence 边渲染星桥; timeline 边保留用于统计。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const WORKSPACE = process.env.OPENCLAW_WORKSPACE
  || path.join(os.homedir(), '.openclaw', 'workspace');
export { WORKSPACE };

// Memory Wiki vault（memory-wiki 插件的共享知识库）。scope=global 时所有 agent 共享。
// 解析顺序：env（仅当路径真实存在）> WORKSPACE 兄弟目录（.openclaw/workspace → .openclaw/wiki/main）。
// 不用 homedir 兜底：gateway 拉起的服务进程 homedir 可能不可靠（实测导致 wiki 扫描恒为空、
// 空目录签名 da39a3ee 被写进增量状态后形成"永远跳过"死循环），而 WORKSPACE 已被各域签名证明可靠。
const _wikiEnv = process.env.OPENCLAW_WIKI_ROOT;
export const WIKI_ROOT = (_wikiEnv && fs.existsSync(_wikiEnv))
  ? _wikiEnv
  : path.join(WORKSPACE, '..', 'wiki', 'main');
let _wikiWarned = false;
export function wikiRootHealth() {
  if (!fs.existsSync(WIKI_ROOT)) {
    if (!_wikiWarned) {
      _wikiWarned = true;
      console.warn(`[graph] WIKI_ROOT 不存在: ${WIKI_ROOT}（wiki 域将扫描为空）`);
    }
    return false;
  }
  return true;
}

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'public', 'memory-graph-data.json');
export const DATA_OUT = OUT;
const DRY = process.argv.includes('--dry-run');

const AGENT_COLORS = {
  root: '#F97316', main: '#06B6D4',
  'c-lao': '#3B82F6', codev: '#22C55E', 'f-lao': '#F59E0B',
  'j-lao': '#A855F7', 'p-lao': '#84CC16', scout: '#14B8A6',
  writer: '#6366F1', news: '#EC4899', 'agent-cluster': '#FF3B30',
  wiki: '#A78BFA',
};
const SUB_AGENTS = ['c-lao', 'codev', 'f-lao', 'j-lao', 'p-lao', 'scout', 'writer', 'news'];
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.openclaw', '.openclaw-wiki', '.dreams', 'FeiControl', 'skills', 'worktrees', 'agent-cluster', '_attachments', '_views']);
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

// 每个 domain 对应一种扫描方式；key 与节点 agent 字段一致。
export const DOMAINS = [
  { key: 'root', kind: 'root' },
  { key: 'main', kind: 'memory' },
  ...SUB_AGENTS.map(a => ({ key: a, kind: 'agent', name: a })),
  { key: 'wiki', kind: 'wiki' },
];

function walkMd(dir, rel = '') {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      out.push(...walkMd(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(rel ? `${rel}/${e.name}` : e.name);
    }
  }
  return out;
}

function walkMdIncludingAgentCluster(dir, rel = '') {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      // agent-cluster 只扫描其 memory/ 子目录
      if (e.name === 'agent-cluster') {
        const clusterMem = path.join(dir, e.name, 'memory');
        out.push(...walkMd(clusterMem, `${rel}/${e.name}/memory`));
        continue;
      }
      if (EXCLUDE_DIRS.has(e.name)) continue;
      out.push(...walkMdIncludingAgentCluster(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(rel ? `${rel}/${e.name}` : e.name);
    }
  }
  return out;
}

function classify(relPath) {
  if (relPath.startsWith('wiki/')) return 'wiki';
  if (relPath.includes('dreaming/deep/')) return 'deep';
  if (relPath.includes('dreaming/light/')) return 'light';
  if (relPath.includes('dreaming/rem/')) return 'rem';
  if (relPath.includes('archive/')) return 'archive';
  const base = path.basename(relPath);
  if (/^\d{4}-\d{2}-\d{2}\.md$/.test(base) && relPath.includes('memory/')) return 'daily';
  return 'doc';
}

// Some workspace notes contain text that was originally UTF-8 but got decoded as
// GBK and re-saved (mojibake), e.g. "馃摎" instead of "📎". The damage is lossy, so
// it cannot be reversed — detect it and fall back to the file name rather than
// rendering garbage in the graph. These characters are essentially never used in
// genuine Chinese prose, which makes them reliable markers.
const MOJIBAKE_MARKERS = /[\uFFFD锛鈥馃锟]/;

function looksLikeMojibake(text) {
  return MOJIBAKE_MARKERS.test(text);
}

function firstHeading(text, fallback) {
  const m = text.match(/^#{1,3}\s+(.+)$/m);
  if (!m) return fallback;
  const heading = m[1].trim().slice(0, 60);
  return looksLikeMojibake(heading) ? fallback : heading;
}

function makeSnip(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`>\[\]#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function nodeFromFile(agent, absPath, relPath) {
  let text = '', stat;
  try { stat = fs.statSync(absPath); text = fs.readFileSync(absPath, 'utf-8'); } catch { return null; }
  const base = path.basename(relPath);
  const dm = base.match(DATE_RE) || relPath.match(DATE_RE);
  const date = dm ? dm[1] : stat.mtime.toISOString().slice(0, 10);
  const type = classify(relPath);
  const wikiBase = base.replace(/\.md$/i, '');
  const title = type === 'doc'
    ? `${base} - ${firstHeading(text, base)}`
    : type === 'wiki'
      ? `${wikiBase} - ${firstHeading(text, wikiBase)}`
      : `${agent} ${type} ${date}`;
  return {
    id: '', title, agent, type, date,
    // NOTE: the key is `snippet` — the graph UI reads node.snippet. It used to be
    // emitted as `snip`, which made every node detail panel show "（暂无摘要）".
    path: relPath, snippet: makeSnip(text), size: stat.size,
    color: AGENT_COLORS[agent] || '#9CA3AF', degree: 0,
    workspace: type === 'wiki' ? 'wiki' : 'workspace',
  };
}

// ---------- 按域收集源文件清单（用于签名 / 增量扫描） ----------
export function domainSources(domain) {
  const items = [];
  if (domain.kind === 'root') {
    let top;
    try { top = fs.readdirSync(WORKSPACE); } catch { top = []; }
    for (const f of top) {
      if (!f.endsWith('.md')) continue;
      const p = path.join(WORKSPACE, f);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isFile()) items.push({ rel: f, abs: p, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
    }
    // 包含 agent-cluster/memory/ 下的文件
    const clusterDir = path.join(WORKSPACE, 'agent-cluster', 'memory');
    const clusterEntries = fs.readdirSync(clusterDir).filter(f => f.endsWith('.md'));
    for (const f of clusterEntries) {
      const p = path.join(clusterDir, f);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      items.push({ rel: `agent-cluster/memory/${f}`, abs: p, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
    }
    return items;
  }
  if (domain.kind === 'wiki') wikiRootHealth();
  const dir = domain.kind === 'memory' ? path.join(WORKSPACE, 'memory')
    : domain.kind === 'wiki' ? WIKI_ROOT
    : path.join(WORKSPACE, domain.name);
  const rel0 = domain.kind === 'memory' ? 'memory'
    : domain.kind === 'wiki' ? 'wiki'
    : domain.name;
  const walk = (d, rel) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!EXCLUDE_DIRS.has(e.name)) walk(p, r);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        items.push({ rel: r, abs: p, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      }
    }
  };
  walk(dir, rel0);
  return items;
}

// 单个域的签名（文件集合 + 大小 + mtime）。域级签名让「删除某个文件」也会被捕获，
// 且未来 mtime 只导致该域一次重建。
export function domainSignature(domain) {
  const items = domainSources(domain).map(it => `${it.rel}|${it.size}|${it.mtimeMs}`).sort();
  const h = crypto.createHash('sha1');
  h.update(items.join('\n'));
  return h.digest('hex');
}

  // 扫描单个域，返回该域节点（尚未分配全局 id）。
  // agent-cluster 的文件归并到 root 域下。
export function scanDomain(domain) {
  const nodes = [];
  if (domain.kind === 'root') {
    let top;
    try { top = fs.readdirSync(WORKSPACE); } catch { top = []; }
    for (const f of top) {
      if (!f.endsWith('.md')) continue;
      const n = nodeFromFile('root', path.join(WORKSPACE, f), f);
      if (n) nodes.push(n);
    }
    // 归并 agent-cluster/memory/
    const clusterDir = path.join(WORKSPACE, 'agent-cluster', 'memory');
    try {
      for (const f of fs.readdirSync(clusterDir)) {
        if (!f.endsWith('.md')) continue;
        const n = nodeFromFile('root', path.join(clusterDir, f), `agent-cluster/memory/${f}`);
        if (n) nodes.push(n);
      }
    } catch { /* agent-cluster 不存在时忽略 */ }
    return nodes;
  }
  const dir = domain.kind === 'memory' ? path.join(WORKSPACE, 'memory')
    : domain.kind === 'wiki' ? WIKI_ROOT
    : path.join(WORKSPACE, domain.name);
  const rel0 = domain.kind === 'memory' ? 'memory'
    : domain.kind === 'wiki' ? 'wiki'
    : domain.name;
  for (const rel of walkMd(dir, rel0)) {
    // wiki 域的 rel 以 wiki/ 开头，但物理根是 WIKI_ROOT 而非 WORKSPACE
    const abs = domain.kind === 'wiki'
      ? path.join(WIKI_ROOT, rel.slice('wiki/'.length))
      : path.join(WORKSPACE, rel);
    const n = nodeFromFile(domain.key, abs, rel);
    if (n) nodes.push(n);
  }
  return nodes;
}

export function assignIds(nodes) {
  nodes.forEach((n, i) => { n.id = `n${i}`; });
}

// 基于全局节点列表计算边（timeline + evidence）。证据边会重新读取 dreaming 文件正文。
export function computeEdges(nodes) {
  const edges = [];
  const groups = new Map();
  for (const n of nodes) {
    const k = `${n.agent}|${n.type}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  let timelineEdges = 0;
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path));
    for (let i = 1; i < arr.length; i++) {
      edges.push({ s: arr[i - 1].id, t: arr[i].id, k: 'timeline' });
      timelineEdges++;
    }
  }
  const byPath = new Map(nodes.map(n => [n.path, n]));
  const EV_RE = /evidence:\s*([^\s:]+(?:\.md|\.txt))/g;
  let evidenceEdges = 0;
  for (const n of nodes) {
    if (!['deep', 'light', 'rem'].includes(n.type)) continue;
    let text;
    try { text = fs.readFileSync(path.join(WORKSPACE, n.path), 'utf-8'); } catch { continue; }
    const seen = new Set();
    for (const m of text.matchAll(EV_RE)) {
      let ref = m[1].replace(/\\/g, '/');
      const dm = ref.match(DATE_RE);
      const target = byPath.get(ref)
        || (dm && byPath.get(`${n.agent}/memory/${dm[1]}.md`))
        || (dm && byPath.get(`memory/${dm[1]}.md`));
      if (target && target.id !== n.id && !seen.has(target.id)) {
        seen.add(target.id);
        edges.push({ s: n.id, t: target.id, k: 'evidence' });
        evidenceEdges++;
      }
    }
  }
  // ---------- [[wikilink]] 边（Obsidian 风格双链） ----------
  // 目标解析优先级：同 agent 同名文件 > wiki 页同名文件 > 任意同名文件 > 完整标题。
  // wiki 页与 workspace doc 都参与解析；边沿用 k:'evidence'，消费端星桥渲染无需区分。
  const byFile = new Map();   // 去扩展名文件名 -> 节点数组
  const byTitle = new Map();  // 完整 title -> 节点
  for (const n of nodes) {
    const f = path.basename(n.path).replace(/\.md$/i, '');
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(n);
    if (!byTitle.has(n.title)) byTitle.set(n.title, n);
  }
  const WL_RE = /\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]/g;
  let linkEdges = 0;
  for (const n of nodes) {
    if (!['doc', 'wiki'].includes(n.type)) continue;
    // wiki 节点的 rel 带 wiki/ 前缀，物理根是 WIKI_ROOT，需要剥掉前缀再拼接
    const relFile = n.workspace === 'wiki' ? n.path.slice('wiki/'.length) : n.path;
    let text;
    try { text = fs.readFileSync(path.join(WIKI_ROOT, relFile), 'utf-8'); } catch { continue; }
    const seen = new Set();
    for (const m of text.matchAll(WL_RE)) {
      const tgt = m[1].trim().replace(/\.md$/i, '');
      if (!tgt) continue;
      const cands = byFile.get(tgt);
      const target = (cands && cands.length
        ? (cands.find(c => c.agent === n.agent) || cands.find(c => c.agent === 'wiki') || cands[0])
        : byTitle.get(tgt)) || null;
      if (target && target.id !== n.id && !seen.has(target.id)) {
        seen.add(target.id);
        edges.push({ s: n.id, t: target.id, k: 'evidence' });
        linkEdges++; evidenceEdges++;
      }
    }
  }
  const deg = new Map();
  for (const e of edges) {
    deg.set(e.s, (deg.get(e.s) || 0) + 1);
    deg.set(e.t, (deg.get(e.t) || 0) + 1);
  }
  nodes.forEach(n => { n.degree = deg.get(n.id) || 0; });
  return { edges, evidenceEdges, timelineEdges, linkEdges };
}

export function assembleData(nodes, edges, evidenceEdges, timelineEdges, linkEdges = 0) {
  const agentCount = new Map();
  for (const n of nodes) agentCount.set(n.agent, (agentCount.get(n.agent) || 0) + 1);
  const agents = [...agentCount.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, color: AGENT_COLORS[id] || '#9CA3AF', count }));
  return {
    generatedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19),
    source: 'OpenClaw agent memory (.openclaw/workspace + wiki/main)',
    agents,
    stats: {
      nodes: nodes.length,
      evidenceEdges,
      timelineEdges,
      linkEdges,
      agents: agents.length,
      fromOpenclaw: nodes.length,
    },
    nodes,
    edges,
  };
}

export function buildGraphData(nodes) {
  assignIds(nodes);
  const { edges, evidenceEdges, timelineEdges, linkEdges } = computeEdges(nodes);
  return assembleData(nodes, edges, evidenceEdges, timelineEdges, linkEdges);
}

function writeAtomic(data, out) {
  if (DRY) { console.log('(dry-run, not written)'); return; }
  const tmp = out + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  // Windows 下若文件正被读取，rename 可能 EPERM；重试几次即可完成原子替换。
  let lastErr;
  for (let i = 0; i < 12; i++) {
    try { fs.renameSync(tmp, out); break; }
    catch (e) {
      lastErr = e;
      if (e.code === 'EPERM' || e.code === 'EACCES') { const end = Date.now() + 150; while (Date.now() < end) {} continue; }
      throw e;
    }
  }
  if (lastErr && fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch {} }
  console.log(`written   : ${out} (${fs.statSync(out).size} bytes)`);
}

// 全量构建（CLI 用）。
export function buildAll() {
  const nodes = [];
  for (const d of DOMAINS) nodes.push(...scanDomain(d));
  const data = buildGraphData(nodes);
  console.log(`workspace : ${WORKSPACE}`);
  console.log(`wiki root : ${WIKI_ROOT} (${fs.existsSync(WIKI_ROOT) ? 'ok' : 'MISSING'})`);
  console.log(`nodes     : ${nodes.length}`);
  console.log(`edges     : ${data.edges.length} (evidence ${data.stats.evidenceEdges - data.stats.linkEdges} / wikilink ${data.stats.linkEdges} / timeline ${data.stats.timelineEdges})`);
  console.log('agents    :', data.agents.map(a => `${a.id}=${a.count}`).join(' '));
  writeAtomic(data, OUT);
}

// 仅当本文件被「直接执行」时才跑全量构建；被 server import 时不会触发。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAll();
}
