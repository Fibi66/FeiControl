// GET /api/memory-graph/files?path=<rel>
// 读取 OpenClaw workspace 内单文件正文（带路径穿越防护），供星系「载入全文」按钮使用。
import { NextRequest, NextResponse } from 'next/server';
import { readWorkspaceFile } from '../../../../lib/memory-graph/graph-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get('path');
  if (!rel) return NextResponse.json({ error: 'missing path' }, { status: 400 });
  const res = readWorkspaceFile(rel);
  if (res.forbidden) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (res.notFound) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ path: rel, content: res.content });
}
