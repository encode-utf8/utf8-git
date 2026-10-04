import { PrismaClient } from "@prisma/client";

// 惰性单例：仅在真正执行查询时创建客户端，避免构建期（无 DATABASE_URL）报错；
// 开发环境把实例挂到 globalThis，避免热重载导致的连接数膨胀。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrismaClient(): PrismaClient {
  globalForPrisma.prisma ??= new PrismaClient();
  return globalForPrisma.prisma;
}
