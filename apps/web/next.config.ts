import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 允许展示 GitHub 头像（登录后的用户资料）
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
};

export default nextConfig;
