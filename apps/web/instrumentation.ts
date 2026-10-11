// Next.js 服务器错误钩子（M4-1）：路由、服务端组件、Server Action 里未捕获的异常
// 都会汇聚到这里。只做结构化上报，不改变请求结果（见 lib/observability.ts）。

import { REQUEST_ID_HEADER, normalizeRequestId, reportError } from "./lib/observability";

type ErrorRequest = Readonly<{
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}>;

type ErrorContext = Readonly<{
  routerKind: string;
  routePath: string;
  routeType: string;
  renderSource?: string;
}>;

export async function onRequestError(
  error: unknown,
  request: ErrorRequest,
  context: ErrorContext,
): Promise<void> {
  const headerValue = request.headers[REQUEST_ID_HEADER];
  const requestId = normalizeRequestId(Array.isArray(headerValue) ? headerValue[0] : headerValue);
  await reportError(error, {
    source: "instrumentation",
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    ...(requestId ? { requestId } : {}),
  });
}
