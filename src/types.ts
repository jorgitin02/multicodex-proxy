export type ProviderId = "openai" | "mistral";
export type QuotaProfile = "auto" | "weekly_only" | "windowed_and_weekly";
export type ProxyRoutingMode = "quota_aware" | "round_robin";
export type ProxySettings = {
  routingMode: ProxyRoutingMode;
};

export type DashboardRangePreset = "24h" | "7d" | "30d" | "all";

export type DashboardTabId =
  | "overview"
  | "accounts"
  | "aliases"
  | "tracing"
  | "playground"
  | "docs";

export type TracingCardId =
  | "tokensOverTime"
  | "modelUsage"
  | "modelCost"
  | "errorTrend"
  | "costOverTime"
  | "latency"
  | "tokenSplit"
  | "accountRequestShare"
  | "accountTokenShare"
  | "accountCostShare"
  | "usageByAccount"
  | "usageByRoute"
  | "topSessions";

export type TopSessionsSortKey =
  | "requests"
  | "tokens"
  | "costUsd"
  | "avgLatencyMs"
  | "lastAt";

export type TopSessionsSortDirection = "asc" | "desc";

export type TopSessionsSortState = {
  key: TopSessionsSortKey;
  direction: TopSessionsSortDirection;
};

export type AccountsSectionId =
  | "requestsByAccount"
  | "tokensByAccount"
  | "costByAccount"
  | "providerQuota";

export type DashboardPreferences = {
  tabOrder: DashboardTabId[];
  ranges: {
    overview: DashboardRangePreset;
    accounts: DashboardRangePreset;
    tracing: DashboardRangePreset;
  };
  tracing: {
    cardOrder: TracingCardId[];
    hiddenCards: TracingCardId[];
    graphsHidden: boolean;
    topSessionsSort: TopSessionsSortState;
  };
  accounts: {
    sectionOrder: AccountsSectionId[];
    hiddenSections: AccountsSectionId[];
  };
};

export type UsageWindow = {
  usedPercent?: number;
  resetAt?: number; // epoch ms
};

export type UsageSnapshot = {
  primary?: UsageWindow; // ~5h window
  secondary?: UsageWindow; // weekly window
  fetchedAt: number;
  profile?: Exclude<QuotaProfile, "auto">;
  scope?: "account" | "unscoped" | "unsupported";
  degradedReason?: string;
};

export type AccountError = {
  at: number;
  message: string;
};

export type AccountState = {
  blockedUntil?: number;
  blockedReason?: string;
  lastError?: string;
  lastSelectedAt?: number;
  recentErrors?: AccountError[];
  needsTokenRefresh?: boolean;
  lastUsageRefreshAt?: number;
  refreshBlockedUntil?: number;
  refreshFailureCount?: number;
  modelAvailability?: Record<
    string,
    {
      supported: boolean;
      checkedAt: number;
      reason?: string;
    }
  >;
};

export type Account = {
  id: string;
  provider?: ProviderId;
  email?: string;
  quotaProfile?: QuotaProfile;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  chatgptAccountId?: string;
  enabled: boolean;
  priority?: number;
  usage?: UsageSnapshot;
  state?: AccountState;
};

export type ModelAlias = {
  id: string;
  targets: string[];
  enabled: boolean;
  description?: string;
};

export type StoreFile = {
  accounts: Account[];
  modelAliases?: ModelAlias[];
  dashboardPreferences?: DashboardPreferences;
  proxySettings?: ProxySettings;
};

export type OAuthFlowState = {
  id: string;
  email: string;
  codeVerifier: string;
  createdAt: number;
  targetAccountId?: string;
  status: "pending" | "success" | "error";
  error?: string;
  completedAt?: number;
  accountId?: string;
};

export type OAuthStateFile = {
  states: OAuthFlowState[];
};
