// 为 build-memory-graph.mjs 提供最小类型声明，避免 TS 在动态 import 时报错。
// 实际实现仍在 scripts/build-memory-graph.mjs（单一事实来源），这里只描述形状。
declare module '*/build-memory-graph.mjs' {
  export const WORKSPACE: string;
  export const DATA_OUT: string;
  export const DOMAINS: { key: string; kind: string; name?: string }[];
  export function domainSignature(domain: { key: string; kind: string; name?: string }): string;
  export function scanDomain(domain: { key: string; kind: string; name?: string }): any[];
  export function buildGraphData(nodes: any[]): any;
}
