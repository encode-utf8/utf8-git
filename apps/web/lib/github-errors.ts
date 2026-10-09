// GitHub API 错误分类（REST 与 GraphQL 数据层共用）
// M1-4 从 github-repos.ts 抽取：GraphQL 客户端与数据服务需要同一套错误语义。

export class GitHubApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

// 401：令牌无效 / 已撤销，需要重新授权
export class GitHubUnauthorizedError extends GitHubApiError {
  constructor(message = "GitHub 授权已失效，请重新授权") {
    super(message, 401);
    this.name = "GitHubUnauthorizedError";
  }
}

// 403：权限不足或被组织策略拒绝（含 SSO 未授权场景）
export class GitHubForbiddenError extends GitHubApiError {
  readonly ssoUrl: string | null;

  constructor(message = "GitHub 拒绝了本次请求（403）", ssoUrl: string | null = null) {
    super(message, 403);
    this.name = "GitHubForbiddenError";
    this.ssoUrl = ssoUrl;
  }
}

// 404：资源不存在，或当前授权不可见（私有仓库常见）
export class GitHubNotFoundError extends GitHubApiError {
  constructor(message = "GitHub 资源不存在或无权访问") {
    super(message, 404);
    this.name = "GitHubNotFoundError";
  }
}

// 403（限流）/ 429：超出 API 配额或触发次级限流
export class GitHubRateLimitError extends GitHubApiError {
  readonly resetAt: Date | null;

  constructor(message = "GitHub API 访问频率超限", resetAt: Date | null = null) {
    super(message, 429);
    this.name = "GitHubRateLimitError";
    this.resetAt = resetAt;
  }
}

// 请求超时（瞬时错误，可重试）
export class GitHubTimeoutError extends GitHubApiError {
  constructor(message = "GitHub 请求超时") {
    super(message, 504);
    this.name = "GitHubTimeoutError";
  }
}

// 网络不可达（断网 / DNS 解析失败 / 连接被拒绝 / fetch 抛出 TypeError）：瞬时错误，可重试。
// 与 GitHubTimeoutError 区分：超时是「请求已发出但无响应」，本类是「请求未能到达」。
export class GitHubNetworkError extends GitHubApiError {
  constructor(message = "无法连接 GitHub（网络错误）") {
    super(message, 503);
    this.name = "GitHubNetworkError";
  }
}

// 422：请求语义非法（分支名非法、引用已存在等）
export class GitHubValidationError extends GitHubApiError {
  constructor(message = "GitHub 拒绝了本次请求（422）") {
    super(message, 422);
    this.name = "GitHubValidationError";
  }
}

// GraphQL 层返回的语义错误（非限流 / 非未找到）
export class GitHubGraphQLError extends GitHubApiError {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message, 502);
    this.name = "GitHubGraphQLError";
    this.details = details;
  }
}
