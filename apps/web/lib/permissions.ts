// GitHub 授权范围说明（登录页与 /permissions 说明页共用，保证文案一致）。
// scope 取值必须与 lib/auth.ts 中 provider 的 authorization.params.scope 保持一致。

export type ScopeExplanation = {
  scope: string;
  title: string;
  purpose: string;
};

export const GITHUB_SCOPES: ScopeExplanation[] = [
  {
    scope: "read:user",
    title: "读取公开资料",
    purpose: "读取你的昵称、头像与登录名，仅用于在界面展示账号信息。",
  },
  {
    scope: "repo",
    title: "读取仓库（含私有）",
    purpose:
      "读取你有权访问的仓库、分支与提交历史，用于生成提交时间线；不会创建、修改或删除任何仓库内容。",
  },
];

// GitHub 上本应用的授权管理页；配置了 AUTH_GITHUB_ID 时直达本应用，否则落到列表页
export function authorizationSettingsUrl(clientId: string | undefined): string {
  return clientId
    ? `https://github.com/settings/connections/applications/${clientId}`
    : `https://github.com/settings/connections/applications`;
}
