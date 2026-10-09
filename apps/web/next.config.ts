import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 以 TS 源码形式消费工作区包，交由 Turbopack / Next 转译
  transpilePackages: ["@utf8-git/git-graph"],
  images: {
    // 允许展示 GitHub 头像（登录后的用户资料）
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
};

export default nextConfig;
