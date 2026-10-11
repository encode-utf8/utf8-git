// GitHub 授权范围说明。scope 取值必须与 lib/auth.ts 中 provider 的 authorization.params.scope 保持一致。
// 标题与用途文案集中在 i18n 消息目录的 `scopes.*`（中英各一份），页面按这里的 `key` 取用，
// 保证登录页与 /permissions 说明页文案一致。

/** 与消息目录 `scopes.<key>.{title,purpose}` 一一对应。 */
export type GithubScopeKey = "readUser" | "repo";

export type GithubScope = {
  /** OAuth scope 字面量（与 lib/auth.ts 的请求参数一致）。 */
  scope: string;
  /** 消息目录中的键名。 */
  key: GithubScopeKey;
};

export const GITHUB_SCOPES: GithubScope[] = [
  { scope: "read:user", key: "readUser" },
  { scope: "repo", key: "repo" },
];

// GitHub 上本应用的授权管理页；配置了 AUTH_GITHUB_ID 时直达本应用，否则落到列表页
export function authorizationSettingsUrl(clientId: string | undefined): string {
  return clientId
    ? `https://github.com/settings/connections/applications/${clientId}`
    : `https://github.com/settings/connections/applications`;
}
