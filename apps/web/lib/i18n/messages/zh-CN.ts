// 中文（源语言）：消息目录的键与结构以本文件为准；`en.ts` 用同一类型约束，漏译会编译报错。
// 约定：叶子必须是字符串；插值用 `{name}`；含链接等富文本的句子按链接拆成多个键
// （如 `revokeBefore` / `revokeLink` / `revokeAfter`），由页面用 JSX 拼装。

/** 消息目录类型（源语言）：`en.ts` 与页面据此约束键名，漏译 / 拼错在编译期报错。 */
export type Messages = typeof zhCN;

export const zhCN = {
  layout: {
    title: "utf8-git · 仓库时间线可视化",
    description:
      "把晦涩的 Git 仓库变成一条可以点着走的时间线：浏览分支、提交、合并与 Issue，并完成常用写操作。",
  },
  common: {
    appName: "utf8-git",
    reload: "重新加载",
    backToLogin: "返回登录",
    backToHome: "返回首页",
  },
  locale: {
    label: "界面语言",
    switchTo: "切换到{language}",
  },
  offline: {
    before: "网络已断开，无法连接 GitHub。请检查网络后",
    after: "。",
  },
  scopes: {
    readUser: {
      title: "读取公开资料",
      purpose: "读取你的昵称、头像与登录名，仅用于在界面展示账号信息。",
    },
    repo: {
      title: "读取仓库（含私有）",
      purpose:
        "读取你有权访问的仓库、分支与提交历史，用于生成提交时间线；不会创建、修改或删除任何仓库内容。",
    },
  },
  login: {
    title: "登录 utf8-git",
    description: "使用 GitHub 账号登录，授权后即可浏览你的提交时间线（含私有仓库）。",
    submit: "使用 GitHub 登录",
    permissionsTitle: "申请的权限与用途",
    tokenNote: "访问令牌仅以 AES-256-GCM 密文存储于服务端数据库，不会返回给浏览器或写入日志。",
    revokeNote:
      "撤销授权：随时前往 GitHub 的 Settings → Applications → Authorized OAuth Apps 中移除 utf8-git，撤销后令牌立即失效。",
    fullNote: "查看完整授权说明",
  },
  permissions: {
    metaTitle: "授权说明 · utf8-git",
    metaDescription: "utf8-git 申请的 GitHub 权限范围、数据使用方式与撤销入口。",
    title: "授权说明",
    description: "utf8-git 使用 GitHub OAuth 登录。下面是申请的全部权限、用途与撤销方式。",
    permissionsTitle: "申请的权限与用途",
    tokenTitle: "我们如何使用令牌",
    tokenStorage: "访问令牌仅以 AES-256-GCM 密文存储于服务端数据库，密钥独立于数据库保管。",
    tokenServerOnly: "仅在服务端调用 GitHub API，浏览器与前端代码接触不到令牌。",
    tokenNoLogs: "令牌不会写入应用日志；令牌过期后通过 refresh token 自动续期。",
    notDoTitle: "我们不会做什么",
    notDoContent: "不会创建、修改或删除任何仓库内容（不提交、不推送、不合并、不改分支保护）",
    notDoIssues: "不会以你的名义创建 Issue / PR / 评论",
    notDoPrivacy: "不会读取仓库之外的隐私数据（如私信、账号设置）",
    notDoToken: "访问令牌不会返回给浏览器，也不会写入应用日志",
    ssoTitle: "组织仓库与 SSO",
    ssoBefore:
      "若组织启用了 SAML SSO，即使授权成功也可能看不到该组织的仓库，需要为 utf8-git 单独批准组织访问。授权成功但仓库为空时，可在",
    ssoLink: "GitHub 授权管理页",
    ssoAfter: "的 Organization access 中授予对应组织。",
    revokeTitle: "如何撤销授权",
    revokeBefore: "随时前往",
    revokeLink: "GitHub 的 Settings → Applications → Authorized OAuth Apps",
    revokeMiddle: "移除 utf8-git，撤销后令牌立即失效，本应用将无法再读取任何仓库。也可以直接在",
    revokeAccountLink: "我的账号",
    revokeAfter:
      "页点「撤销 GitHub 授权」：它会调用 GitHub 接口撤销令牌，并删除本应用保存的令牌密文与登录会话。",
    purgeTitle: "如何清除本应用的数据",
    purgeBody:
      "「我的账号」页的「清除我的数据」会删除本应用保存的全部账号数据——访问令牌、登录会话、写操作审计记录与缓存，并删除该账号在本应用中的用户记录，随后自动结束登录会话。这是不可恢复的操作；它不会影响你 GitHub 上的仓库、提交、Issue 与 PR。",
  },
};
