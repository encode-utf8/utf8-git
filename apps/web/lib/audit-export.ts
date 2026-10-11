// TODO-233 审计日志导出：把写操作审计导出为 CSV / JSON（纯逻辑，无 IO）。
// 与操作历史页（M3-7）同源：等价命令与结果链接都复用 git-commands，导出内容与页面一致。

import { operationGitCommand, operationResultLink, type ResultLink } from "./git-commands";
import { sourceTranslate, type Translate } from "./i18n/translate";
import {
  operationKindLabel,
  operationStatusLabel,
  type OperationAuditRecord,
  type OperationAuditStatus,
  type OperationKind,
} from "./operations";

export const AUDIT_EXPORT_FORMATS = ["csv", "json"] as const;
export type AuditExportFormat = (typeof AUDIT_EXPORT_FORMATS)[number];

/** 单次导出的操作条数上限（按「操作条数」计，防止超大账号把响应撑爆）。 */
export const AUDIT_EXPORT_MAX_OPERATIONS = 1000;

/** 预取的原始记录条数上限：一次操作通常写 started + 终态两条，取 3 倍留足余量。 */
export const AUDIT_EXPORT_SCAN_LIMIT = AUDIT_EXPORT_MAX_OPERATIONS * 3;

/** 读取导出格式：缺省或非法值一律回退 CSV。 */
export function parseAuditExportFormat(raw: string | null | undefined): AuditExportFormat {
  const value = (raw ?? "").trim().toLowerCase();
  return (AUDIT_EXPORT_FORMATS as readonly string[]).includes(value)
    ? (value as AuditExportFormat)
    : "csv";
}

/** 导出条目：对外暴露的稳定字段（不含执行器返回的原始 result，避免结构随操作漂移）。 */
export type AuditExportEntry = {
  recordedAt: string;
  repo: string;
  kind: OperationKind;
  kindLabel: string;
  status: OperationAuditStatus;
  statusLabel: string;
  summary: string;
  error: string | null;
  payload: Record<string, string>;
  gitCommand: string;
  resultLink: ResultLink | null;
  idempotencyKey: string;
};

export function auditRecordToEntry(
  record: OperationAuditRecord,
  t: Translate = sourceTranslate,
): AuditExportEntry {
  return {
    recordedAt: record.recordedAt,
    repo: record.repo,
    kind: record.kind,
    kindLabel: operationKindLabel(record.kind, t),
    status: record.status,
    statusLabel: operationStatusLabel(record.status, t),
    summary: record.summary,
    error: record.error,
    payload: record.payload,
    gitCommand: operationGitCommand(record.kind, record.repo, record.payload),
    resultLink: operationResultLink(record.kind, record.repo, record.payload, record.result, t),
    idempotencyKey: record.idempotencyKey,
  };
}

/** CSV 列名与操作历史页同一套文案，随界面语言切换。 */
function csvColumns(t: Translate): string[] {
  return [
    t("ops.export.time"),
    t("ops.export.repo"),
    t("ops.export.kind"),
    t("ops.export.status"),
    t("ops.export.summary"),
    t("ops.export.error"),
    t("ops.export.command"),
    t("ops.export.link"),
    t("ops.export.key"),
    t("ops.export.payload"),
  ];
}

/** RFC 4180 转义：含逗号 / 引号 / 换行的单元格用双引号包裹，内部引号翻倍。 */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 一个导出条目对应一行（顺序与 CSV 列名一致）。 */
function entryToRow(entry: AuditExportEntry): string[] {
  return [
    entry.recordedAt,
    entry.repo,
    entry.kindLabel,
    entry.statusLabel,
    entry.summary,
    entry.error ?? "",
    entry.gitCommand,
    entry.resultLink ? entry.resultLink.href : "",
    entry.idempotencyKey,
    JSON.stringify(entry.payload),
  ];
}

/** 审计记录 → CSV 文本（含表头，RFC 4180 的 CRLF 行尾；不含 BOM，由调用方按需补）。 */
export function auditRecordsToCsv(
  records: OperationAuditRecord[],
  t: Translate = sourceTranslate,
): string {
  const columns = csvColumns(t);
  const lines = [columns.map(csvCell).join(",")];
  for (const record of records) {
    lines.push(entryToRow(auditRecordToEntry(record, t)).map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** 审计记录 → JSON 文本（带导出时间与条数，便于接收方校验完整性）。 */
export function auditRecordsToJson(
  records: OperationAuditRecord[],
  generatedAt: Date,
  t: Translate = sourceTranslate,
): string {
  const operations = records.map((record) => auditRecordToEntry(record, t));
  return `${JSON.stringify({ exportedAt: generatedAt.toISOString(), count: operations.length, operations }, null, 2)}\n`;
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/** 导出文件名：utf8-git-audit-YYYYMMDD.csv / .json。 */
export function auditExportFilename(format: AuditExportFormat, generatedAt: Date): string {
  const date = `${generatedAt.getUTCFullYear()}${two(generatedAt.getUTCMonth() + 1)}${two(
    generatedAt.getUTCDate(),
  )}`;
  return `utf8-git-audit-${date}.${format}`;
}

export type AuditExportBundle = {
  body: string;
  contentType: string;
  filename: string;
};

/** 组装一次导出的响应体与响应头（CSV 不含 BOM，调用方按需在响应前补）。 */
export function buildAuditExport(
  records: OperationAuditRecord[],
  options: { format: AuditExportFormat; generatedAt?: Date; t?: Translate },
): AuditExportBundle {
  const generatedAt = options.generatedAt ?? new Date();
  const t = options.t ?? sourceTranslate;
  const isCsv = options.format === "csv";
  return {
    body: isCsv ? auditRecordsToCsv(records, t) : auditRecordsToJson(records, generatedAt, t),
    contentType: isCsv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    filename: auditExportFilename(options.format, generatedAt),
  };
}
