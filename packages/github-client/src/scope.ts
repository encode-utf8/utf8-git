/**
 * 解析 GitHub OAuth 返回的 scope 字符串。
 * 兼容空格/逗号分隔与空值；scope 为小写，重复项只保留一次。
 */
export function parseScopes(rawScope: string | null | undefined): string[] {
  if (!rawScope) {
    return [];
  }
  return [...new Set(rawScope.split(/[\s,]+/).filter((scope) => scope.length > 0))];
}

/** 判断是否已授权指定 scope（私有仓库依赖 `repo`，见需求分析 D2）。 */
export function hasScope(rawScope: string | null | undefined, scope: string): boolean {
  return parseScopes(rawScope).includes(scope);
}
