// 部署自检：把「部署配置是否正确」变成可查询、可脚本化校验的结果。
// 只返回布尔与说明文字，绝不返回密钥内容或连接串。

import { getPrismaClient } from "./prisma";
import { resolveStoreBackend, type StoreBackend } from "./shared-store";

// 生产库必须具备的表；缺表说明迁移未执行，或 DATABASE_URL 指向了错误的库
export const REQUIRED_TABLES = [
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
  "shared_cache_entries",
  "rate_limit_states",
] as const;

// 必须存在的密钥类环境变量（只判断有无，不读出内容）
export const REQUIRED_SECRET_ENV = [
  "AUTH_SECRET",
  "AUTH_TOKEN_ENC_KEY",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
] as const;

// AUTH_TOKEN_ENC_KEY 需为 32 字节的 base64（AES-256-GCM）
export const TOKEN_ENC_KEY_BYTES = 32;

// 函数与数据库跨区域时，每次查询都要走一趟跨洋 RTT；超过该值基本可判定未同区部署。
// 参考：一次登录后的页面 / 接口请求会串行执行 4~6 次数据库查询（会话 + 令牌 + 缓存 + 限流 + 游标）。
export const SLOW_DATABASE_RTT_MS = 150;

export type HealthCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type HealthReport = {
  ok: boolean;
  storeBackend: StoreBackend;
  /** 当前运行时是否要求共享存储（Serverless 会横向扩容，必须共享） */
  sharedStoreRequired: boolean;
  /** Vercel 注入的函数运行区（本地运行 / 平台未注入时为 null） */
  functionRegion: string | null;
  checks: HealthCheck[];
  /** 可用但配置不理想的问题；不计入 ok，不触发 503 */
  warnings: string[];
};

export type HealthDeps = {
  env?: Record<string, string | undefined>;
  listTables?: () => Promise<string[]>;
  pingDatabase?: () => Promise<void>;
};

// 错误信息里可能带出连接串，对外输出前统一抹掉
export function redactConnectionInfo(text: string): string {
  // 抹掉连接串，并把多行错误压成一行，便于在自检输出里对齐展示
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

async function defaultPingDatabase(): Promise<void> {
  await getPrismaClient().$queryRaw`SELECT 1`;
}

async function defaultListTables(): Promise<string[]> {
  const rows = await getPrismaClient().$queryRaw<
    Array<{ table_name: string }>
  >`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  return rows.map((row) => row.table_name);
}

function describeStoreBackend(backend: StoreBackend, sharedStoreRequired: boolean): HealthCheck {
  if (backend === "postgres") {
    return {
      name: "store_backend",
      ok: true,
      detail: "STORE_BACKEND=postgres：缓存 / 游标链 / 限流快照跨实例共享",
    };
  }
  if (sharedStoreRequired) {
    // 这是「翻页随机报 409 cursor_expired」的根因：第 1 页的游标链写在这个实例，
    // 第 2 页请求落到别的实例就读不到，同时缓存全部失效导致每次回源 GitHub。
    return {
      name: "store_backend",
      ok: false,
      detail:
        "Serverless 环境未设置 STORE_BACKEND=postgres：缓存与游标链按实例隔离，" +
        "翻页会随机报 409 cursor_expired，且每次请求都回源 GitHub（表现为很慢）",
    };
  }
  return {
    name: "store_backend",
    ok: true,
    detail: "STORE_BACKEND=memory：仅适用于单实例 / 本地开发",
  };
}

function checkSecrets(env: Record<string, string | undefined>): HealthCheck[] {
  const checks: HealthCheck[] = REQUIRED_SECRET_ENV.map((name) => {
    const present = Boolean(env[name]?.trim());
    return {
      name: `env:${name}`,
      ok: present,
      detail: present ? "已设置" : "未设置（登录或拉取仓库会失败）",
    };
  });

  const raw = env.AUTH_TOKEN_ENC_KEY?.trim();
  if (raw) {
    const bytes = Buffer.from(raw, "base64").length;
    checks.push({
      name: "auth_token_enc_key_length",
      ok: bytes === TOKEN_ENC_KEY_BYTES,
      detail:
        bytes === TOKEN_ENC_KEY_BYTES
          ? `base64 解码 ${bytes} 字节（AES-256-GCM）`
          : `base64 解码 ${bytes} 字节，应为 ${TOKEN_ENC_KEY_BYTES} 字节`,
    });
  }

  return checks;
}

export async function runHealthChecks(deps: HealthDeps = {}): Promise<HealthReport> {
  const env = deps.env ?? process.env;
  const pingDatabase = deps.pingDatabase ?? defaultPingDatabase;
  const listTables = deps.listTables ?? defaultListTables;

  const storeBackend = resolveStoreBackend(env.STORE_BACKEND);
  // Vercel 会注入 VERCEL=1；本地 next start 不会，此时 memory 后端是合理配置
  const sharedStoreRequired = Boolean(env.VERCEL);
  const functionRegion = env.VERCEL_REGION?.trim() || null;

  const checks: HealthCheck[] = [describeStoreBackend(storeBackend, sharedStoreRequired)];
  const warnings: string[] = [];

  let databaseReachable = true;
  const coldStartedAt = Date.now();
  try {
    await pingDatabase();
    // 首次查询通常包含建连（TCP + TLS + 认证），Neon 还可能要先唤醒计算节点，
    // 因此它不能代表稳态往返；跨区判断只看第二次的「热」往返，避免同区误报。
    const coldMs = Date.now() - coldStartedAt;
    const warmStartedAt = Date.now();
    await pingDatabase();
    const warmMs = Date.now() - warmStartedAt;

    checks.push({
      name: "database_reachable",
      ok: true,
      detail: `数据库连接正常（首次 ${coldMs} ms / 热往返 ${warmMs} ms）`,
    });

    if (warmMs > SLOW_DATABASE_RTT_MS) {
      warnings.push(
        `数据库热往返 ${warmMs} ms（阈值 ${SLOW_DATABASE_RTT_MS} ms）：函数区 ${functionRegion ?? "未知"} 与数据库区大概率不一致。` +
          "登录后的每次页面 / 接口请求会串行执行 4~6 次数据库查询，跨区往返会直接放大成秒级延迟；" +
          '建议把函数部署到数据库同区（如 Neon 在 ap-southeast-1 时用 vercel.json 的 regions: ["sin1"]），或把数据库建在函数同区。',
      );
    }
  } catch (error) {
    databaseReachable = false;
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      name: "database_reachable",
      ok: false,
      detail: `数据库连接失败：${redactConnectionInfo(message)}`,
    });
  }

  if (databaseReachable) {
    try {
      const tables = new Set(await listTables());
      const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
      checks.push({
        name: "required_tables",
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? `业务表齐全（${REQUIRED_TABLES.length} 张）`
            : `缺少表：${missing.join(", ")}（需对生产库执行 prisma migrate deploy）`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        name: "required_tables",
        ok: false,
        detail: `表结构核对失败：${redactConnectionInfo(message)}`,
      });
    }
  }

  checks.push(...checkSecrets(env));

  return {
    ok: checks.every((check) => check.ok),
    storeBackend,
    sharedStoreRequired,
    functionRegion,
    checks,
    warnings,
  };
}
