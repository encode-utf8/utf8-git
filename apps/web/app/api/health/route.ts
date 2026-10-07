import { NextResponse } from "next/server";

import { runHealthChecks } from "@/lib/health";

// 部署自检入口：无鉴权，只暴露布尔结论与说明文字，用于部署后一条命令核对配置。
// 全部通过返回 200，任一失效返回 503（便于监控 / 平台探针直接判定实例不可用）。
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await runHealthChecks();
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
