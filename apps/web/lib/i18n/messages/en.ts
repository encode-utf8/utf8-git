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
    cancel: "Cancel",
    close: "Close",
  },
  locale: {
    label: "Interface language",
    switchTo: "Switch to {language}",
  },
  offline: {
    before: "You are offline, so GitHub cannot be reached. Check your connection and",
    after: ".",
  },
  errors: {
    offline: {
      title: "You are offline",
      message:
        "This device has no connection, so GitHub cannot be reached. Check the network and retry.",
      action: "Retry",
    },
    network: {
      title: "Cannot reach GitHub",
      message:
        "The request never reached GitHub (a network break, proxy or DNS issue). Please retry later.",
      action: "Retry",
    },
    timeout: {
      title: "Request timed out",
      message:
        "GitHub did not respond in time; the network may be slow or the service busy. Please retry.",
      action: "Retry",
    },
    rateLimited: {
      title: "GitHub API rate limit exceeded",
      messageWithReset:
        "GitHub's request quota is temporarily exhausted, expected to recover at {time}. Cached data (if any) is shown; retry once it recovers.",
      message:
        "GitHub's request quota is temporarily exhausted and no cached data is available. Please retry later.",
      action: "Retry",
    },
    unauthorized: {
      title: "GitHub authorization expired",
      message: "The token may have been revoked or expired. Reconnect to continue.",
      action: "Reconnect",
    },
    forbidden: {
      title: "Access denied by GitHub (403)",
      message:
        "Possible causes: the organization uses SAML SSO without approving this app, or the current authorization lacks the required scope. Reconnect or handle it on GitHub.",
      action: "Reconnect",
    },
    notFound: {
      title: "Resource missing or no access",
      message:
        "It may have been deleted or renamed, or the current authorization does not cover this private resource.",
      action: "Back to list",
    },
    cursorExpired: {
      title: "Pagination data expired",
      message:
        "The server-side pagination cursor is no longer valid. Refresh the page and load from page one.",
      action: "Refresh page",
    },
    serverError: {
      title: "GitHub is temporarily unavailable",
      message: "GitHub returned a server error. Please retry later.",
      messageWithStatus: "GitHub returned a server error ({status}). Please retry later.",
      action: "Retry",
    },
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
  timeline: {
    invalidPath: {
      title: "Invalid repository address",
      before: "Please open it again from",
      link: "My repositories",
      after: ".",
    },
    tokenInvalidBody:
      "The token may have been revoked or expired. Reconnect to keep browsing the timeline.",
    notFound: {
      title: "Repository not found or no access",
      body: "It may have been deleted or renamed, or the current authorization does not include this private repository.",
      link: "Back to my repositories",
    },
    operations: "Operation history",
    openOnGithub: "Open on GitHub",
    backToList: "Back to list",
    warningsBefore: "Some related data could not be fetched: ",
    warningSeparator: "; ",
    branchLabel: "Branch",
    lane: "Lane",
    actions: {
      createBranch: "New branch",
      createIssue: "New issue",
      createPull: "New pull request",
      deleteBranch: "Delete branch",
      restoreBranch: "Restore branch",
    },
    explainLabel: "Term explanations",
    explainModeLabel: "Term explanation mode",
    loadedCommits: "{count} commits loaded",
    newBranchName: "New branch name",
    commitLabel: "commit {sha}",
    branchStart: "Start: commit {sha}",
    branchCreated: "Created branch {branch}",
    createBranchNetworkError: "Network error — the branch was not created. Please try again later.",
    searchPlaceholder: "Search commit / SHA / author",
    searchLabel: "Search commits",
    filterByAuthor: "Filter by author",
    allAuthors: "All authors",
    filterByKind: "Filter by event type",
    kindAll: "All events",
    kindMerge: "Merge commits only",
    kindPull: "Linked pull requests only",
    kindIssue: "Linked issues only",
    rangeLabel: "Time range",
    rangeAll: "All time",
    rangeWeek: "Past week",
    rangeMonth: "Past month",
    filteredCount: "{filtered} / {total} shown",
    clearFilters: "Clear filters",
    emptyBranch: "No commits on this branch (empty repository or no history).",
    noMatches: "No matching commits ({count} loaded).",
    listLabel: "Commit timeline",
    autoLoadHint: "Scroll to the bottom to load more automatically",
    reachedEnd: "You have reached the end",
    loadMore: "Load more",
    unknownAuthor: "Unknown author",
    noHeadline: "(no commit message)",
    viewCommitDetail: "View details of commit {sha}",
    issueLinkTitle: "Issue: {title}",
    prState: {
      open: "Open",
      merged: "Merged",
      closed: "Closed",
    },
    issueState: {
      open: "Open",
      closed: "Closed",
    },
  },
  time: {
    justNow: "just now",
    minutesAgo: "{count} minutes ago",
    hoursAgo: "{count} hours ago",
    daysAgo: "{count} days ago",
  },
  confirm: {
    executing: "Working…",
  },
  glossary: {
    modeOff: "Off",
    modeBeginner: "Beginner",
    modeAdvanced: "Advanced",
    hint: "Explain: {term}",
    note: "{term}: ",
    author: {
      term: "Commit author",
      summary: "The account that wrote this change.",
      detail:
        "The author comes from the commit's author field and may differ from the committer, for example when merging someone else's pull request.",
    },
    sha: {
      term: "Commit hash (SHA)",
      summary: "The unique fingerprint of a commit, computed from its contents.",
      detail:
        "It is 40 hex digits in full; the interface usually shows the first 7. It permanently points at this change, and branches, tags and operation records refer to it.",
    },
    merge: {
      term: "Merge commit",
      summary: "A commit that joins two branches' histories, so it has two or more parents.",
      detail:
        "A timeline node flagged merge usually comes from merging branches; its parents point at both sides of the merge.",
    },
    branch: {
      term: "Branch",
      summary:
        "An independent line of work split off from a commit, where you can change things without touching the main line.",
      detail:
        "Creating a branch just adds a new reference from a commit; it changes no existing branch or commit. Commits land on the branch and later merge back through a pull request.",
    },
    "pull-request": {
      term: "Pull request",
      summary: "A request to merge one branch's changes into another, with discussion and review.",
      detail:
        "The main line is unaffected until it is merged. Merging brings the source branch's commits into the target branch and is usually irreversible. The #number badges on the timeline link to the matching pull request on GitHub.",
    },
    issue: {
      term: "Issue",
      summary:
        "An entry for recording a problem, request or discussion; it contains no code changes.",
      detail:
        "Creating an issue changes no code, branch or commit. It becomes linked to a change when a commit message or pull request description mentions “fixes #123”, and then appears on the timeline.",
    },
    lane: {
      term: "Lane",
      summary: "The vertical track on the left of the timeline that each branch follows.",
      detail:
        "Nodes in the same lane belong to the same line of history; when history forks or merges, the connector moves between lanes, and colours only distinguish the lines.",
    },
  },
  panels: {
    bodyPreviewEmpty: "(body preview)",
    createIssue: {
      title: "Issue title",
      titlePlaceholder: "Briefly describe the problem or request",
      titleHint: "A title is required, up to {max} characters.",
      body: "Body (Markdown)",
      bodyPlaceholder: "## Steps to reproduce\n\n- First step\n\n**Expected**: …",
      labels: "Labels (comma separated)",
      labelsHint: "Up to {count} labels, each no longer than {max} characters.",
      bodyPreview: "Body preview",
      created: "Created issue {number}{title}",
      networkError: "Network error — the issue was not created. Please try again later.",
    },
    createPull: {
      needTwoBranchesTitle: "Cannot create a pull request",
      needTwoBranchesBody:
        "A repository needs at least two branches to create a pull request. Create a branch first.",
      base: "Base branch",
      head: "Head branch",
      title: "Pull request title",
      titlePlaceholder: "Briefly describe this change",
      titleHint: "A title is required, up to {max} characters.",
      body: "Pull request body (Markdown)",
      bodyPlaceholder: "## Background\n\n- What changed\n\n**Verified**: …",
      draft: "Create as draft",
      bodyPreview: "Body preview",
      created: "Created pull request {number}{title}",
      networkError: "Network error — the pull request was not created. Please try again later.",
    },
    deleteBranch: {
      select: "Branch to delete",
      defaultSuffix: " (default)",
      checkError: "Could not check whether “{branch}” can be deleted: {message}",
      checking: "Checking whether “{branch}” can be deleted…",
      notDeletable: "Cannot delete: {reason}",
      notDeletableHint:
        "Choose another branch; the default and protected branches can only be changed in the GitHub repository settings.",
      deleted: "Deleted branch {branch}",
      networkError: "Network error — the branch was not deleted. Please try again later.",
    },
    mergePull: {
      checkError: "Could not check whether pull request #{number} can be merged: {message}",
      checking: "Checking whether pull request #{number} can be merged…",
      cannotMerge: "Cannot merge pull request #{number}",
      checkReason: "Mergeability check: {reason}",
      notAllowed: "The current state does not allow merging.",
      checkPassed: "Mergeability check: mergeable",
      method: "Merge method",
      defaultBranch: "default branch",
      headBranch: "head branch",
      merged: "Merged pull request #{number}",
      networkError: "Network error — the merge did not complete. Please try again later.",
    },
    restoreBranch: {
      listError: "Could not load restorable deletions: {message}",
      loading: "Loading restorable deletions…",
      emptyTitle: "No branches to restore",
      emptyBody:
        "Only branches this app deleted successfully in the last 24 hours and whose commit SHA was saved are listed; branches deleted another way cannot be restored here.",
      legend: "Choose a deletion to restore",
      candidate: "Restore {branch} ({remaining})",
      hint: "Restoring only recreates the branch reference pointing at the commit from before deletion; it does not restore branch protection rules, and branches removed with other tools cannot be restored.",
      impossible: "Cannot restore: {reason}",
      restored: "Restored branch {branch}",
      networkError: "Network error — the branch was not restored. Please try again later.",
    },
  },
  ops: {
    kind: {
      createBranch: "Create branch",
      createIssue: "Create issue",
      createPullRequest: "Create pull request",
      mergePullRequest: "Merge pull request",
      deleteBranch: "Delete branch",
      restoreBranch: "Restore branch",
      revokeAuthorization: "Revoke authorization",
      purgeAccountData: "Erase data",
    },
    status: {
      started: "In progress",
      succeeded: "Succeeded",
      failed: "Failed",
    },
    history: {
      title: "Operation history",
      backToTimeline: "Back to timeline",
      description:
        "Lists only the write operations you started in this app ({count} per page, failures included); each entry comes with the equivalent Git / gh command and a result link. The git commands assume",
      descriptionCode: "origin",
      descriptionAfter:
        "points at this repository; they are for reference and copying only — this app never runs them.",
      statusLabel: "Status",
      statusFilterLabel: "Filter by status",
      filterAll: "All",
      filterSucceeded: "Succeeded only",
      filterFailed: "Failed only",
      invalidRepo: "The repository path is invalid, so the operation history cannot be shown.",
      loadFailedBefore:
        "Operation history is temporarily unavailable: the server-side tables may not be ready. Retry later; if it keeps failing, check",
      loadFailedLink: "deployment self-check",
      loadFailedAfter: ".",
      emptyFiltered: "No records on this page match the filters.",
      backToAll: "Back to all records",
      empty:
        "No write operations yet. Create a branch, file an issue, merge a pull request or delete a branch on the timeline, and the audit record will show up here.",
      failureReason: "Failure reason: {message}",
      gitCommand: "Equivalent command",
      paginationLabel: "Operation history pagination",
      previousPage: "Previous",
      nextPage: "Next",
      pageNumber: "Page {page}",
    },
    link: {
      viewBranch: "View branch on GitHub",
      viewBranches: "View branch list",
      viewIssue: "View issue #{number}",
      viewIssuePlain: "View issue",
      viewPull: "View pull request #{number}",
      viewPullPlain: "View pull request",
    },
    export: {
      time: "Time (UTC)",
      repo: "Repository",
      kind: "Operation",
      status: "Status",
      summary: "Summary",
      error: "Failure reason",
      command: "Equivalent command",
      link: "Result link",
      key: "Idempotency key",
      payload: "Payload (JSON)",
    },
    failure: {
      unauthorized: "The authorization is no longer valid. Sign in again and retry.",
      forbidden: "Insufficient permissions to complete this operation.",
      notFound: "The repository does not exist or you have no access.",
      rateLimited: "Too many GitHub requests. Please try again later.",
      unreachable: "Cannot reach GitHub. Check your connection and retry.",
      timeout: "The GitHub request timed out. Please retry.",
      confirmationRequired: "Confirm this operation in the card first.",
      tooManyRequests: "Too many operations. Please try again later.",
      revokeUnavailable:
        "The server has no GitHub app credentials, so self-service revocation is unavailable; remove the authorization in GitHub settings instead.",
      badRequest: "Invalid request parameters. Check your input.",
      mergeFailed: "GitHub could not complete the merge.",
      generic: "The operation failed. Please try again later.",
    },
    conflict: {
      createBranch: "The branch already exists or the name is not accepted. Try another name.",
      createIssue: "The issue title or content was not accepted. Check it and retry.",
      createPullRequest:
        "A pull request for this branch pair already exists, or the title was not accepted. Check it and retry.",
      mergePullRequest:
        "The pull request cannot be merged right now (it may be merged, closed, or have conflicts).",
      deleteBranch: "The branch is missing, protected or already deleted. Refresh and retry.",
      restoreBranch:
        "The branch already exists or the commit SHA is unreachable, so it cannot be restored. Refresh and retry.",
    },
    branchName: {
      empty: "The branch name cannot be empty.",
      tooLong: "The branch name cannot exceed {max} characters.",
      illegalChars:
        "The branch name cannot contain spaces or ~ ^ : ? * [ \\ and similar characters.",
      leadingDash: "The branch name cannot start with -.",
      leadingSlash: "The branch name cannot start or end with /.",
      trailingDot: "The branch name cannot end with .",
      atSign: "The branch name cannot be @.",
      doubleDot: "The branch name cannot contain consecutive ..",
      atBrace: "The branch name cannot contain @{",
      doubleSlash: "The branch name cannot contain consecutive //",
      emptySegment: "No segment of the branch name may be empty.",
      dotSegment: "No segment of the branch name may start with .",
      lockSegment: "No segment of the branch name may end with .lock",
    },
    issueTitle: {
      empty: "The issue title cannot be empty.",
      tooLong: "The issue title cannot exceed {max} characters.",
    },
    issueBody: {
      tooLong: "The body is too long.",
    },
    issueLabels: {
      tooMany: "At most {count} labels.",
      newline: "A label cannot contain a line break.",
      tooLong: "A single label cannot exceed {max} characters.",
    },
    pullTitle: {
      empty: "The pull request title cannot be empty.",
      tooLong: "The pull request title cannot exceed {max} characters.",
    },
    pullBody: {
      tooLong: "The pull request body cannot exceed {max} characters.",
    },
    pullBranches: {
      headInvalid: "Head branch: {reason}",
      baseInvalid: "Base branch: {reason}",
      same: "The head and base branches cannot be the same.",
    },
    mergeMethod: {
      merge: "Merge commit",
      squash: "Squash and merge",
      rebase: "Rebase and merge",
    },
    mergeability: {
      merged: "This pull request is already merged.",
      closed: "This pull request is closed and cannot be merged.",
      draft: "This pull request is still a draft; mark it ready for review first.",
      conflict: "There are merge conflicts that must be resolved first.",
      blocked: "Blocked by branch protection rules or required checks.",
      notAllowed: "The current Git state does not allow an automatic merge.",
      pending: "GitHub has not finished computing mergeability yet. Please retry later.",
    },
    deletion: {
      notFound: "The branch does not exist or you have no access.",
      selectBranch: "Choose a branch to delete.",
      defaultBranch: "The default branch cannot be deleted.",
      protected: "This branch is protected and cannot be deleted.",
      current: "You cannot delete the branch you are currently viewing.",
    },
    restore: {
      notFound: "No restorable deletion record was found. Refresh and retry.",
      unavailable: "This deletion record cannot be restored.",
      missingBranch: "A branch name to restore is required.",
      missingSha: "This deletion record has no commit SHA and cannot be restored.",
      invalidTime: "The deletion record has an invalid time and cannot be restored.",
      windowExpired: "The {hours}-hour restore window has passed; it cannot be restored.",
      unknownWindow: "restore window unknown",
      expired: "restore window expired",
      remainingHours: "about {hours} hours left",
      remainingMinutes: "about {minutes} minutes left",
    },
    account: {
      revokeSummary: "Revoke utf8-git's GitHub authorization",
      revokeImpact1:
        "Calls the GitHub API to revoke this app's access token; it stops working immediately",
      revokeImpact2:
        "Deletes the encrypted token stored by this app, plus the account's caches and GitHub quota snapshots",
      revokeImpact3:
        "Ends the current login session: signing in and authorizing again is required to continue",
      revokeImpact4:
        "Keeps existing write-operation audit records (use “Erase my data” to delete them all)",
      purgeSummary: "Erase account data in utf8-git",
      purgeImpact1:
        "Deletes this app's account record, encrypted token and login session, and signs you out immediately",
      purgeImpact2:
        "Deletes your write-operation audit records ({records}) and all caches and quota snapshots for this account",
      purgeImpact3:
        "Best-effort revokes the access token with GitHub; local data is erased even if revocation fails",
      purgeImpact4:
        "Does not affect repositories, commits, issues or pull requests on GitHub (this app only reads and displays them)",
      revokeConflict:
        "GitHub refused the revocation. Retry later, or remove the authorization manually in GitHub Settings → Applications.",
      purgeConflict:
        "Data erasure did not complete. Retry later; if it keeps failing, file an issue in the repository.",
    },
    descriptor: {
      createBranch: {
        summary: "Create branch {branch} in {repo}",
        from: "Create branch {branch} from {fromLabel} ({sha})",
        noChange: "Changes no existing branch or commit",
      },
      createIssue: {
        summary: "Create an issue in {repo}: {title}",
        created: "New issue “{title}”",
        labels: "Labels: {labels}",
        noLabels: "No labels",
        noChange: "Changes no code, branch or commit",
      },
      createPullRequest: {
        summary: "Create a pull request in {repo}: {head} → {base}",
        created: "New pull request “{title}”: {head} → {base}",
        draft: "Create as a draft (no merge requested yet)",
        ready: "Create as a mergeable pull request",
        noChange: "Changes no branch or commit",
      },
      mergePullRequest: {
        summary: "Merge pull request #{number} in {repo}: {title}",
        merge: "Merge {head} into {base} (method: {method})",
        result: "Pull request #{number} becomes “merged”, usually irreversible",
        noDeleteBranch: "Deletes no branch",
      },
      deleteBranch: {
        summary: "Delete branch {branch} in {repo}",
        remove: "Delete branch {branch}; its reference is removed from the repository",
        keepCommits:
          "Deletes no commit: removed commits remain reachable from other branches or tags",
        head: "The branch pointed at {sha} before deletion; record that SHA first if you may need to restore it",
        restoreHint: "One-click restore arrives in M3-6; for now record the SHA yourself",
      },
      restoreBranch: {
        summary: "Restore branch {branch} in {repo}",
        rePoint: "Point branch {branch} back at commit {sha} from before deletion",
        noChange: "Changes no other branch or commit",
        noProtection:
          "The restored branch does not inherit the previous protection rules; re-enable them in the GitHub repository settings if needed",
      },
    },
  },
  me: {
    title: "My account",
    toReposBefore: "Go to",
    toReposLink: "My repositories",
    toReposAfter: "to see the repository list.",
    avatarAlt: "Avatar of {name}",
    githubUser: "GitHub user",
    noNickname: "No display name",
    sessionPolicy: "Session strategy",
    sessionPolicyValue: "Database session (revocable server-side)",
    scope: "Authorized scopes",
    tokenExpires: "Token expires at",
    tokenNeverExpires: "The current authorization has no expiry",
    audit: "Write-operation audit",
    auditCount: "{count} records",
    permissionsNoteBefore: "Read the full notes on scopes and data handling in",
    permissionsNoteLink: "Authorization notes",
    permissionsNoteAfter: ".",
    exportTitle: "Export operation audit",
    exportBody:
      "Download the write-operation audit as CSV / JSON; the content matches the “Operation history” page.",
    exportCsv: "Download CSV",
    exportJson: "Download JSON",
    signOut: "Sign out",
    dangerTitle: "Dangerous actions",
    dangerBody: "Both actions need confirmation; the current session ends as soon as one runs.",
    revoke: "Revoke GitHub authorization",
    purge: "Erase my data",
    signOutHome: "Sign out and go home",
    donePurge:
      "Account data erased from this app: audit records, caches and the account record are gone, and the session has ended.",
    doneRevoke:
      "GitHub authorization revoked: the token is invalid, the local ciphertext is deleted, and the session has ended.",
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
