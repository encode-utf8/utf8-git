import { decryptToken } from "./crypto";
import { getPrismaClient } from "./prisma";

// 读取并解密当前用户的 GitHub access token（仅限服务端调用，禁止返回前端）
export async function getGitHubAccessToken(userId: string): Promise<string | null> {
  const account = await getPrismaClient().account.findFirst({
    where: { userId, provider: "github" },
    orderBy: { id: "desc" },
  });
  if (!account?.accessTokenEnc) {
    return null;
  }
  return decryptToken(account.accessTokenEnc);
}
