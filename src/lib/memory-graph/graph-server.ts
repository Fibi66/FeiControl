// src/lib/memory-graph/graph-server.ts
//
// Memory Galaxy 的「实时重建」核心逻辑，作为 FeiControl（Next.js）的一部分运行。
// 状态保存在模块级变量中，随 Next.js 进程常驻，因此多个 API 请求共享同一份缓存
// 与重建锁（进程内状态，取代原独立服务 memory-graph-server.mjs）。
//
// 特性（与原独立服务一致）：
//  - 源签名：按 OpenClaw workspace 的「按域签名」检测新增/修改/删除
//  - 增量重建：仅重扫签名变化的 agent 域，复用其余域已扫描节点
//  - SWR：快照陈旧时立即返回旧数据（首请求不阻塞），后台静默重建
//  - 并发锁：多个请求复用同一重建
//  - 原子写：写 .tmp 再 rename（带 EPERM 重试，Windows 友好）
//
// 扫描/构图逻辑复用 scripts/build-memory-graph.mjs（单一事实来源），本模块只负责
// 状态机、签名、原子写与文件读取。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { homedir } from 'node:os';

const FEI_ROOT = process.cwd();
const PUBLIC_DIR = path.join(FEI_ROOT, 'public');
export const DATA_FILE = path.join(PUBLIC_DIR, 'memory-graph-data.json');
/**
 * Synthetic dataset committed to the repo. Used as a fallback when this machine
 * has no OpenClaw workspace (a fresh clone), so the graph is still browsable.
 * DATA_FILE itself is a git-ignored runtime artifact — it holds the operator's
 * real notes and must never be committed. Regenerate the demo with
 * `node scripts/make-demo-graph.mjs`.
 */
const DEMO_FILE = path.join(PUBLIC_DIR, 'memory-graph-demo.json');
const STATE_FILE = path.join(FEI_ROOT, '.memory-graph-state.json');

const EMPTY_GRAPH = {
  nodes: [],
  edges: [],
  agents: [],
  stats: { nodes: 0, evidenceEdges: 0, timelineEdges: 0, linkEdges: 0, agents: 0, fromOpenclaw: 0 },
};

// 与 build-memory-graph.mjs / FeiControl 现有约定保持一致
const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ||
  path.join(process.env.OPENCLAW_DIR || path.join(homedir(), '.openclaw'), 'workspace');

type Domain = { key: string; kind: string; name?: string };
type BuildModule = {
  WORKSPACE: string;
  DOMAINS: Domain[];
  domainSignature: (d: Domain) => string;
  scanDomain: (d: Domain) => any[];
  buildGraphData: (nodes: any[]) => any;
};

let buildModule: BuildModule | null = null;
async function getBuild(): Promise<BuildModule> {
  if (!buildModule) {
    const mod: any = await import('../../../scripts/build-memory-graph.mjs');
    buildModule = mod as BuildModule;
  }
  return buildModule;
}

// ---------- 签名 / 状态 ----------
async function domainSigsNow(): Promise<Record<string, string>> {
  const { DOMAINS, domainSignature } = await getBuild();
  const m: Record<string, string> = {};
  for (const d of DOMAINS) m[d.key] = domainSignature(d);
  return m;
}

async function globalSigOf(domainSigs: Record<string, string>): Promise<string> {
  const { DOMAINS } = await getBuild();
  const h = crypto.createHash('sha1');
  h.update(DOMAINS.map((d) => `${d.key}=${domainSigs[d.key]}`).join('\n'));
  return h.digest('hex');
}

function readState(): { sig: string; domains: Record<string, string>; builtAt: number } | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeState(globalSig: string, domainSigs: Record<string, string>): void {
  const tmp = STATE_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ sig: globalSig, domains: domainSigs, builtAt: Date.now() }));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e: any) {
    console.error('[galaxy] failed to write state:', e?.message);
  }
}

// Windows 下若旧快照正被读取，rename 会返回 EPERM；短暂自旋重试即可完成原子替换。
function renameWithRetry(tmp: string, out: string): void {
  let lastErr: any;
  for (let i = 0; i < 12; i++) {
    try {
      fs.renameSync(tmp, out);
      return;
    } catch (e: any) {
      lastErr = e;
      if (e.code === 'EPERM' || e.code === 'EACCES') {
        const end = Date.now() + 150;
        while (Date.now() < end) { /* busy wait ~150ms */ }
        continue;
      }
      throw e;
    }
  }
  try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
  throw lastErr;
}

function writeDataAtomically(data: any): void {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  renameWithRetry(tmp, DATA_FILE);
}

// ---------- 重建（进程内增量 + 并发锁）----------
let buildPromise: Promise<void> | null = null;
let lastData: any = null;

async function runBuild(domainSigs: Record<string, string>, globalSig: string): Promise<void> {
  if (!buildPromise) {
    buildPromise = (async () => {
      const { DOMAINS, scanDomain, buildGraphData } = await getBuild();
      const prev = readState();
      const prevDomains = (prev && prev.domains) || {};
      const snapExists = fs.existsSync(DATA_FILE);
      let merged: any[];
      if (!snapExists) {
        merged = [];
        for (const d of DOMAINS) merged.push(...scanDomain(d));
      } else {
        let prevData: any = null;
        try { prevData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch { prevData = null; }
        const prevByAgent = new Map<string, any[]>();
        if (prevData && Array.isArray(prevData.nodes)) {
          for (const n of prevData.nodes) {
            if (!prevByAgent.has(n.agent)) prevByAgent.set(n.agent, []);
            prevByAgent.get(n.agent)!.push(n);
          }
        }
        merged = [];
        for (const d of DOMAINS) {
          const changed = prevDomains[d.key] !== domainSigs[d.key];
          if (changed || !prevData) {
            merged.push(...scanDomain(d));
          } else {
            merged.push(...(prevByAgent.get(d.key) || []));
          }
        }
      }
      const data = buildGraphData(merged);
      writeDataAtomically(data);
      lastData = data;
      writeState(globalSig, domainSigs);
      console.log(
        `[galaxy] rebuilt: ${data.stats.nodes} nodes, ${data.stats.evidenceEdges} evidence, ` +
        `${data.stats.timelineEdges} timeline, ${data.stats.linkEdges ?? 0} links, ` +
        `${data.agents?.length ?? 0} agents (incremental)`
      );
    })().finally(() => { buildPromise = null; });
  }
  return buildPromise;
}

export type Freshness = 'fresh' | 'stale' | 'built';

// ---------- 数据文件安全读取（防原子写 race condition）----------
function readDataFile(): any | null {
  try {
    const stat = fs.statSync(DATA_FILE);
    // 跳过空文件/截断文件（rename 中间态）
    if (stat.size < 64) return null;
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // 空图谱（例如工作区不存在时扫到 0 个节点）视作无数据，交由演示数据兜底
    if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 读取仓库内置的演示数据（无真实工作区时兜底）。 */
function readDemoFile(): any | null {
  try {
    const raw = fs.readFileSync(DEMO_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 本机是否存在 OpenClaw 工作区（决定能否真实重建）。 */
function workspaceExists(): boolean {
  try {
    return fs.existsSync(WORKSPACE);
  } catch {
    return false;
  }
}

export async function ensureFresh(): Promise<Freshness> {
  // 没有工作区就无从扫描，直接返回，避免写入空快照覆盖掉已有数据
  if (!workspaceExists()) return 'fresh';

  const ds = await domainSigsNow();
  const g = await globalSigOf(ds);
  const prev = readState();
  const snapExists = fs.existsSync(DATA_FILE);
  if (prev && prev.sig === g && snapExists) return 'fresh';
  if (snapExists) {
    // Stale but usable: return immediately with lastData, rebuild in background
    runBuild(ds, g).catch((e) => console.error('[galaxy] background rebuild failed:', e?.message));
    return 'stale';
  }
  await runBuild(ds, g);
  return 'built';
}

export async function getGraphData(): Promise<any> {
  // lastData 是主数据源，文件只是持久化层
  if (lastData) return lastData;

  // 无 OpenClaw 工作区（新克隆 / 未部署 OpenClaw）→ 直接用演示数据
  if (!workspaceExists()) {
    return readDemoFile() || EMPTY_GRAPH;
  }

  await ensureFresh();

  // 优先返回内存缓存
  if (lastData) return lastData;

  // 兜底：读文件（带大小校验）
  const fileData = readDataFile();
  if (fileData) return fileData;

  // 真实数据不可用 → 演示数据，避免前端空白
  return readDemoFile() || EMPTY_GRAPH;
}

// ---------- 安全读取 workspace 文件（供「载入全文」/查看页使用）----------
export interface ReadResult {
  content?: string;
  forbidden?: boolean;
  notFound?: boolean;
}

export function readWorkspaceFile(rel: string): ReadResult {
  if (!rel) return { notFound: true };
  const abs = path.resolve(WORKSPACE, rel);
  if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + path.sep)) {
    return { forbidden: true };
  }
  try {
    const content = fs.readFileSync(abs, 'utf-8');
    return { content };
  } catch {
    return { notFound: true };
  }
}

export { WORKSPACE };
