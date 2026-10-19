import Image from "next/image";
import Link from "next/link";

import { auth, signIn } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n/server";

const REPO = "encode-utf8/utf8-git";
const DOCS_BASE = `https://github.com/${REPO}/blob/main/docs`;

/**
 * 落地页：产品介绍 + 登录入口 + 文档导航。
 * 已登录的用户主按钮直接进仓库列表；未登录走 GitHub OAuth（与 /login 同一条链路）。
 * 页面按语言渲染；纯装饰的界面示意见 CanvasPreview。
 */
export default async function Home() {
  const { t } = await getTranslator();
  const session = await auth();
  const user = session?.user;

  async function loginWithGitHub() {
    "use server";
    await signIn("github", { redirectTo: "/repos" });
  }

  const docLinks = [
    { label: t("landing.docReadme"), href: `https://github.com/${REPO}#readme` },
    { label: t("landing.docSelfHosting"), href: `${DOCS_BASE}/self-hosting.md` },
    { label: t("landing.docDeployment"), href: `${DOCS_BASE}/deployment.md` },
    { label: t("landing.docDevlog"), href: `${DOCS_BASE}/development-log.md` },
  ];

  const features = [
    { title: t("landing.feature1Title"), body: t("landing.feature1Body") },
    { title: t("landing.feature2Title"), body: t("landing.feature2Body") },
    { title: t("landing.feature3Title"), body: t("landing.feature3Body") },
    { title: t("landing.feature4Title"), body: t("landing.feature4Body") },
  ];

  const steps = [
    { title: t("landing.step1Title"), body: t("landing.step1Body") },
    { title: t("landing.step2Title"), body: t("landing.step2Body") },
    { title: t("landing.step3Title"), body: t("landing.step3Body") },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <section className="border-b border-black/[.06] bg-zinc-50 dark:border-white/[.08] dark:bg-black">
        <div className="mx-auto grid max-w-5xl gap-10 px-6 py-16 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[.08] bg-white px-3 py-1 text-[11px] font-medium text-zinc-600 dark:border-white/[.145] dark:bg-zinc-900 dark:text-zinc-300">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              {t("landing.badge")}
            </span>
            <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
              {t("landing.heroTitle")}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
              {t("landing.heroSubtitle")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {user ? (
                <Link
                  href="/repos"
                  className="flex h-11 items-center rounded-full bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {t("landing.ctaEnter")}
                </Link>
              ) : (
                <form action={loginWithGitHub}>
                  <button
                    type="submit"
                    className="flex h-11 items-center gap-2 rounded-full bg-[#24292f] px-6 text-sm font-medium text-white transition-colors hover:bg-[#3a4048]"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="h-4 w-4"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                    </svg>
                    {t("landing.ctaLogin")}
                  </button>
                </form>
              )}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("landing.ctaPermissions")}
              </span>
            </div>
            {user ? (
              <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                {user.image ? (
                  <Image
                    src={user.image}
                    alt=""
                    width={20}
                    height={20}
                    className="h-5 w-5 rounded-full"
                  />
                ) : null}
                {t("landing.signedInAs", { user: user.name ?? "" })}
              </p>
            ) : null}
          </div>

          <CanvasPreview label={t("landing.previewAria")} railText={t("timeline.trashIdle")} />
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-14">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("landing.featuresTitle")}
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.145] dark:bg-zinc-950"
            >
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-black/[.06] bg-zinc-50 dark:border-white/[.08] dark:bg-black">
        <div className="mx-auto w-full max-w-5xl px-6 py-14">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("landing.stepsTitle")}
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.145] dark:bg-zinc-950"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
                  {index + 1}
                </span>
                <h3 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-14">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("landing.docsTitle")}
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("landing.docsNote")}</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {docLinks.map((doc) => (
            <li key={doc.href}>
              <a
                href={doc.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-3 rounded-xl border border-black/[.08] bg-white px-4 py-3 text-sm text-zinc-700 transition-colors hover:border-black/[.16] hover:bg-zinc-50 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-white/[.24] dark:hover:bg-zinc-900"
              >
                <span>{doc.label}</span>
                <span
                  aria-hidden="true"
                  className="text-zinc-400 transition-transform group-hover:-translate-y-0.5"
                >
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-600 dark:text-zinc-300">
            {t("landing.linksTitle")}
          </span>
          <Link
            href="/login"
            className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {t("landing.linkLogin")}
          </Link>
          <Link
            href="/permissions"
            className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {t("landing.linkPermissions")}
          </Link>
          <a
            href={t("landing.linkRepoHref")}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {t("landing.linkRepo")}
          </a>
        </div>
        <p className="mt-6 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
          {t("landing.scopeNote")}
        </p>
      </section>
    </div>
  );
}

/**
 * 纯 CSS 的界面示意（无交互、无数据）：泳道 + 提交节点 + 芯片条 + 删除竖轨 + 时间刷子。
 * 用最直白的方式告诉访客「这东西长什么样、能怎么拖」。
 */
function CanvasPreview({ label, railText }: { label: string; railText: string }) {
  const lanes = [28, 84, 140, 196];
  const nodes = [
    { lane: 28, top: 48, width: 96, tone: "sky" as const },
    { lane: 84, top: 74, width: 128, tone: "sky" as const, tag: "#208" },
    { lane: 140, top: 56, width: 80, tone: "sky" as const },
    { lane: 28, top: 102, width: 112, tone: "merge" as const },
    { lane: 196, top: 96, width: 88, tone: "sky" as const },
    { lane: 140, top: 128, width: 144, tone: "sky" as const },
    { lane: 84, top: 152, width: 72, tone: "sky" as const },
  ];

  return (
    <div
      role="img"
      aria-label={label}
      className="relative h-52 overflow-hidden rounded-2xl border border-black/[.08] bg-white shadow-sm select-none dark:border-white/[.145] dark:bg-zinc-950"
    >
      {/* 分支芯片条 */}
      <div className="absolute left-4 top-4 flex items-center gap-1.5">
        <span className="flex h-6 items-center rounded-full border border-zinc-900 bg-zinc-900 px-2.5 text-[10px] font-medium text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900">
          main
        </span>
        <span className="flex h-6 items-center gap-1 rounded-full border border-black/[.12] px-2.5 text-[10px] text-zinc-600 dark:border-white/[.16] dark:text-zinc-300">
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-sky-500" />
          feature/e2e
        </span>
        <span className="flex h-6 w-5 items-center justify-center rounded-full border border-black/[.12] text-[10px] text-zinc-400 dark:border-white/[.16] dark:text-zinc-500">
          ⋯
        </span>
      </div>

      {/* 泳道线 */}
      {lanes.map((left) => (
        <span
          key={left}
          aria-hidden="true"
          style={{ left }}
          className="absolute bottom-12 top-11 w-px bg-zinc-200 dark:bg-zinc-800"
        />
      ))}

      {/* 提交节点：点 + 摘要横条 */}
      {nodes.map((node) => (
        <span key={`${node.lane}-${node.top}`} aria-hidden="true">
          <span
            style={{ left: node.lane, top: node.top }}
            className={[
              "absolute h-2 w-2 rounded-full",
              node.tone === "merge" ? "bg-orange-500" : "bg-sky-500",
            ].join(" ")}
          />
          {node.tag ? (
            <span
              style={{ left: node.lane + 8 + node.width + 6, top: node.top - 4 }}
              className="absolute rounded-full border border-emerald-300 px-1.5 py-0.5 text-[8px] leading-none text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
            >
              {node.tag}
            </span>
          ) : null}
        </span>
      ))}
      {/* 横条有宽有窄，单独渲染 */}
      {nodes.map((node) => (
        <span
          key={`bar-${node.lane}-${node.top}`}
          aria-hidden="true"
          style={{ left: node.lane + 8, top: node.top + 3, width: node.width }}
          className="absolute h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700"
        />
      ))}

      {/* 删除竖轨（常驻右侧） */}
      <span
        aria-hidden="true"
        className="absolute right-0 top-0 bottom-0 flex w-9 flex-col items-center justify-center gap-1 rounded-r-2xl border-l border-red-200 bg-red-50/80 dark:border-red-900/60 dark:bg-red-950/40"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-3.5 w-3.5 text-red-500 dark:text-red-400"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 7h12m-9 0v12m6-12v12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 .8 13a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1L18 7"
          />
        </svg>
        <span className="text-[7px] leading-none text-red-500 [writing-mode:vertical-rl] dark:text-red-400">
          {railText}
        </span>
      </span>

      {/* 时间刷子 */}
      <span
        aria-hidden="true"
        className="absolute bottom-4 left-6 right-12 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800"
      >
        <span className="absolute -top-1 left-16 h-1.5 w-24 rounded-full bg-zinc-900 dark:bg-zinc-100" />
        <span className="absolute -top-[3px] left-[58px] h-3 w-1 rounded-sm bg-zinc-900 dark:bg-zinc-100" />
        <span className="absolute -top-[3px] left-[188px] h-3 w-1 rounded-sm bg-zinc-900 dark:bg-zinc-100" />
      </span>
    </div>
  );
}
