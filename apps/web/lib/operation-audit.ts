// M3-1 写操作审计存储：接口 + 内存实现（Postgres 实现见 pg-stores.ts）。
// 内存实现用于单测与 STORE_BACKEND=memory 的单实例 / 本地开发。

import type { OperationAuditRecord, OperationAuditSink } from "./operations";

export type OperationAuditQuery = {
  repo?: string;
  actor?: string;
  limit?: number;
};

/** 审计存储：写操作管线只依赖 find / append；list 供后续「操作历史」页（M3-7）使用。 */
export interface OperationAuditStoreLike extends OperationAuditSink {
  list(query?: OperationAuditQuery): Promise<OperationAuditRecord[]>;
}

export const DEFAULT_AUDIT_LIMIT = 50;

/** 内存审计存储：按写入顺序保留；find 返回该幂等键最近的一条。 */
export class MemoryOperationAuditStore implements OperationAuditStoreLike {
  private readonly records: OperationAuditRecord[] = [];

  async find(idempotencyKey: string): Promise<OperationAuditRecord | null> {
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      if (this.records[index].idempotencyKey === idempotencyKey) {
        return this.records[index];
      }
    }
    return null;
  }

  async append(record: OperationAuditRecord): Promise<void> {
    this.records.push(record);
  }

  /** 最新优先；支持按仓库 / 操作人过滤与条数上限。 */
  async list(query: OperationAuditQuery = {}): Promise<OperationAuditRecord[]> {
    const limit = query.limit ?? DEFAULT_AUDIT_LIMIT;
    return this.records
      .filter((record) => (query.repo ? record.repo === query.repo : true))
      .filter((record) => (query.actor ? record.actor === query.actor : true))
      .slice(-limit)
      .reverse();
  }
}
