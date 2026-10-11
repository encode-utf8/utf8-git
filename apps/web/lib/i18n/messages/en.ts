// English：结构与 `zh-CN.ts` 完全一致（用 `Messages` 类型约束，漏键 / 多键都会编译报错）。
// 语言名等少数文案保持各语言自称，见 `config.ts` 的 LOCALE_LABELS。

import type { Messages } from "./zh-CN";

export const en: Messages = {
  layout: {
    title: "utf8-git · Repository timelines you can click through",
    description:
      "Turn a hard-to-read Git repository into a timeline you can click through: browse branches, commits, merges and issues, and run common write operations.",
  },
  common: {
    appName: "utf8-git",
    reload: "Reload",
    retry: "Retry",
    loading: "Loading…",
    backToLogin: "Back to sign in",
    backToHome: "Back to home",
    private: "Private",
    public: "Public",
    listSeparator: ", ",
    utcSuffix: " (UTC)",
    unknownTime: "Unknown time",
  },
  locale: {
    label: "Interface language",
    switchTo: "Switch to {language}",
  },
  offline: {
    before: "You are offline, so GitHub cannot be reached. Check your connection and",
    after: ".",
  },
  scopes: {
    readUser: {
      title: "Read your public profile",
      purpose: "Reads your name, avatar and username, only to show your account in the interface.",
    },
    repo: {
      title: "Read repositories (including private)",
      purpose:
        "Reads the repositories, branches and commit history you can access in order to build the timeline. It never creates, modifies or deletes repository content.",
    },
  },
  login: {
    title: "Sign in to utf8-git",
    description:
      "Sign in with your GitHub account to browse your commit timeline, including private repositories.",
    submit: "Sign in with GitHub",
    permissionsTitle: "Scopes requested and why",
    tokenNote:
      "Access tokens are stored server-side as AES-256-GCM ciphertext only; they are never sent to the browser or written to logs.",
    revokeNote:
      "To revoke access, remove utf8-git from GitHub's Settings → Applications → Authorized OAuth Apps; the token stops working immediately.",
    fullNote: "Read the full authorization notes",
  },
  repos: {
    title: "My repositories",
    subtitle:
      "Repositories you created, contribute to, or can access through an organization (including private ones).",
    account: "Account",
    reauth: "Reconnect GitHub",
    reauthShort: "Reconnect",
    noToken: {
      title: "GitHub is not connected yet",
      body: "This account has no usable GitHub token — the authorization may have been revoked. Reconnect to continue.",
    },
    tokenInvalid: {
      title: "GitHub authorization expired",
      body: "The token may have been revoked or expired. Reconnect to keep browsing your repositories.",
    },
    rateLimit: {
      title: "GitHub API rate limit exceeded",
      before: "GitHub's request quota is temporarily exhausted",
      reset: ", expected to reset at {time}",
      after: ". There is no cached data to show right now — retry after the quota resets.",
    },
    forbidden: {
      title: "Access denied by GitHub (403)",
      body: "The organization may use SAML SSO without this app being approved, or the current authorization may lack the required scope.",
      ssoBefore: "Please",
      ssoLink: "complete organization SSO authorization",
      ssoAfter: "and retry (or open the authorization link GitHub returned).",
      manageBefore: "Check organization access on the",
      manageLink: "GitHub authorized apps page",
      manageAfter: ", or reconnect.",
    },
    api: {
      title: "GitHub is temporarily unavailable",
      body: "GitHub returned a server error ({status}). Please retry later.",
    },
    empty: {
      title: "No repositories found",
      intro: "Possible causes and what you can do:",
      createBefore: "The account has no repositories yet: you can",
      createLink: "create a repository on GitHub",
      createAfter: "first.",
      ssoBefore:
        "Organization repositories are missing: the organization may use SAML SSO and needs to approve this app (",
      ssoLink: "open the GitHub authorized apps page",
      ssoAfter: "and grant access under Organization access).",
      scopeBefore: "The authorization scope may be insufficient:",
      scopeLink: "read the authorization notes",
      scopeAfter: "and reconnect, making sure the repo scope is included.",
    },
    degraded: {
      title: "GitHub quota exhausted — showing cached data",
      before: "Data fetched at {time}",
      reset: ", live data expected at {time}",
      after: ".",
    },
    sso: {
      title: "Some organization repositories are hidden",
      body: "{orgs}uses SAML SSO; approve organization access for utf8-git first.",
      authorizeLink: "Complete SSO authorization",
      manageLink: "Open the authorized apps page",
    },
  },
  repoList: {
    searchPlaceholder: "Search repository name or description",
    searchLabel: "Search repositories",
    visibilityLabel: "Visibility filter",
    visibilityAll: "All",
    sortLabel: "Sort by",
    sortUpdated: "Recently updated",
    sortName: "Name",
    count: "{count} repositories",
    countFiltered: ", showing {count}",
    empty: "No matching repositories.",
    clearFilters: "Clear filters",
    archived: "Archived",
    openOnGithub: "Open {name} on GitHub",
    defaultBranch: "Default branch {branch}",
    stars: "★ {count}",
    updatedAt: "Updated {date}",
    loadMore: "Load more",
  },
  permissions: {
    metaTitle: "Authorization notes · utf8-git",
    metaDescription:
      "The GitHub scopes utf8-git requests, how the data is used, and how to revoke access.",
    title: "Authorization notes",
    description:
      "utf8-git signs you in with GitHub OAuth. Here are all the scopes it requests, what they are for, and how to revoke them.",
    permissionsTitle: "Scopes requested and why",
    tokenTitle: "How we use the token",
    tokenStorage:
      "Access tokens are stored in the server database as AES-256-GCM ciphertext only, with the key kept separately from the database.",
    tokenServerOnly:
      "GitHub API calls happen on the server only; the browser and front-end code never touch the token.",
    tokenNoLogs:
      "The token is never written to application logs, and is renewed automatically with the refresh token before it expires.",
    notDoTitle: "What we never do",
    notDoContent:
      "Create, modify or delete any repository content (no commits, pushes, merges or branch protection changes)",
    notDoIssues: "Create issues, pull requests or comments on your behalf",
    notDoPrivacy:
      "Read private data outside your repositories (such as direct messages or account settings)",
    notDoToken: "Return the access token to the browser or write it to application logs",
    ssoTitle: "Organization repositories and SSO",
    ssoBefore:
      "If your organization uses SAML SSO, you may not see its repositories even after authorizing — organization access has to be approved for utf8-git separately. If authorization succeeds but the repository list is empty, use the",
    ssoLink: "GitHub authorized apps page",
    ssoAfter: "and grant access to the organization under Organization access.",
    revokeTitle: "How to revoke access",
    revokeBefore: "Go to",
    revokeLink: "GitHub's Settings → Applications → Authorized OAuth Apps",
    revokeMiddle:
      "and remove utf8-git; the token stops working immediately and this app can no longer read any repository. You can also click “Revoke GitHub authorization” on the",
    revokeAccountLink: "My account",
    revokeAfter:
      "page: it calls the GitHub API to revoke the token and deletes the encrypted token and login session stored by this app.",
    purgeTitle: "How to erase this app's data",
    purgeBody:
      "“Erase my data” on the “My account” page deletes everything this app stores for your account — access token, login session, write-operation audit records and caches — and removes your user record, then ends your session. This cannot be undone. It does not affect repositories, commits, issues or pull requests on GitHub.",
  },
};
