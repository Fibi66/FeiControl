// GET /api/memory-graph/data
// 返回实时星系数据快照；访问时按需触发增量重建（SWR）。
import { NextResponse } from 'next/server';
import { getGraphData } from '../../../../lib/memory-graph/graph-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getGraphData();
    // 验证数据结构，防止返回损坏数据给前端
    if (!data || !Array.isArray(data.nodes)) {
      return NextResponse.json({ error: 'no data' }, { status: 503 });
    }
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'internal' }, { status: 500 });
  }
}
