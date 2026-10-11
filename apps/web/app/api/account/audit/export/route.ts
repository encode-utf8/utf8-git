import { NextResponse } from "next/server";

import {
  AUDIT_EXPORT_MAX_OPERATIONS,
  AUDIT_EXPORT_SCAN_LIMIT,
  buildAuditExport,
  parseAuditExportFormat,
} from "@/lib/audit-export";
import { auth } from "@/lib/auth";
import { getDataStores } from "@/lib/data-stores";
import { latestPerIdempotencyKey } from "@/lib/operation-audit";

// 审计日志导出：GET /api/account/audit/export?format=csv|json
// 导出当前用户在全部仓库的写操作审计（与操作历史页同一份数据、同一收敛口径），
// 供用户自行留存或作为合规数据导出；只读，不写审计、不计入写操作频率限制。
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const format = parseAuditExportFormat(new URL(request.url).searchParams.get("format"));

  // 预取足够多的原始记录（started + 终态分开写），按幂等键收敛成「每次操作一条」再截断上限
  const rows = await getDataStores().operationAudit.list({
    actor: userId,
    limit: AUDIT_EXPORT_SCAN_LIMIT,
  });
  const operations = latestPerIdempotencyKey(rows).slice(0, AUDIT_EXPORT_MAX_OPERATIONS);

  const { body, contentType, filename } = buildAuditExport(operations, { format });
  // CSV 前置 BOM：让 Excel 等工具按 UTF-8 识别中文列名与内容
  const payload = format === "csv" ? `\uFEFF${body}` : body;

  return new NextResponse(payload, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
