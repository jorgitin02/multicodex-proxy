import type {
  AccountsSectionId,
  DashboardPreferences,
  DashboardTabId,
  TopSessionsSortState,
  TracePagination,
  TraceStats,
  TraceUsageStats,
  TracingCardId,
  UsageSummary,
} from "../types";

export const TRACE_PAGE_SIZE = 50;
export const CHART_COLORS = ["#1f7a8c", "#2da4b8", "#4c956c", "#f4a259", "#e76f51", "#8a5a44", "#355070", "#43aa8b"];
export const DEFAULT_TAB_ORDER: DashboardTabId[] = ["overview", "accounts", "aliases", "tracing", "playground", "docs"];
export const DEFAULT_TRACING_CARD_ORDER: TracingCardId[] = [
  "tokensOverTime",
  "modelUsage",
  "modelCost",
  "errorTrend",
  "costOverTime",
  "latency",
  "tokenSplit",
  "accountRequestShare",
  "accountTokenShare",
  "accountCostShare",
  "usageByAccount",
  "usageByRoute",
  "topSessions",
];
export const DEFAULT_ACCOUNTS_SECTION_ORDER: AccountsSectionId[] = [
  "requestsByAccount",
  "tokensByAccount",
  "costByAccount",
  "providerQuota",
];
export const DEFAULT_TOP_SESSIONS_SORT: TopSessionsSortState = { key: "requests", direction: "desc" };
export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  tabOrder: DEFAULT_TAB_ORDER,
  ranges: {
    overview: "7d",
    accounts: "7d",
    tracing: "7d",
  },
  tracing: {
    cardOrder: DEFAULT_TRACING_CARD_ORDER,
    hiddenCards: [],
    graphsHidden: false,
    topSessionsSort: DEFAULT_TOP_SESSIONS_SORT,
  },
  accounts: {
    sectionOrder: DEFAULT_ACCOUNTS_SECTION_ORDER,
    hiddenSections: [],
  },
};

export const EMPTY_TRACE_STATS: TraceStats = {
  totals: {
    requests: 0,
    errors: 0,
    errorRate: 0,
    tokensInput: 0,
    tokensOutput: 0,
    tokensTotal: 0,
    costUsd: 0,
    latencyAvgMs: 0,
  },
  models: [],
  timeseries: [],
};

export const EMPTY_TRACE_PAGINATION: TracePagination = {
  page: 1,
  pageSize: TRACE_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPrev: false,
  hasNext: false,
};

const EMPTY_USAGE_SUMMARY: UsageSummary = {
  requests: 0,
  ok: 0,
  errors: 0,
  successRate: 0,
  stream: 0,
  streamingRate: 0,
  latencyMsTotal: 0,
  avgLatencyMs: 0,
  requestsWithUsage: 0,
  tokens: {
    prompt: 0,
    completion: 0,
    total: 0,
  },
  costUsd: 0,
  statusCounts: {},
};

export const EMPTY_TRACE_USAGE_STATS: TraceUsageStats = {
  filters: {},
  totals: EMPTY_USAGE_SUMMARY,
  byAccount: [],
  byRoute: [],
  bySession: [],
  tracesEvaluated: 0,
  tracesMatched: 0,
};

/** Trust server-normalized preferences; fall back to defaults if missing/malformed. */
export function normalizeDashboardPreferences(input: unknown): DashboardPreferences {
  if (!input || typeof input !== "object") return DEFAULT_DASHBOARD_PREFERENCES;
  const raw = input as Partial<DashboardPreferences>;
  return {
    tabOrder: Array.isArray(raw.tabOrder) && raw.tabOrder.length ? raw.tabOrder : DEFAULT_DASHBOARD_PREFERENCES.tabOrder,
    ranges: {
      overview: raw.ranges?.overview ?? DEFAULT_DASHBOARD_PREFERENCES.ranges.overview,
      accounts: raw.ranges?.accounts ?? DEFAULT_DASHBOARD_PREFERENCES.ranges.accounts,
      tracing: raw.ranges?.tracing ?? DEFAULT_DASHBOARD_PREFERENCES.ranges.tracing,
    },
    tracing: {
      cardOrder: Array.isArray(raw.tracing?.cardOrder) && raw.tracing!.cardOrder.length
        ? raw.tracing!.cardOrder
        : DEFAULT_DASHBOARD_PREFERENCES.tracing.cardOrder,
      hiddenCards: Array.isArray(raw.tracing?.hiddenCards) ? raw.tracing!.hiddenCards : [],
      graphsHidden: raw.tracing?.graphsHidden === true,
      topSessionsSort: raw.tracing?.topSessionsSort ?? DEFAULT_TOP_SESSIONS_SORT,
    },
    accounts: {
      sectionOrder: Array.isArray(raw.accounts?.sectionOrder) && raw.accounts!.sectionOrder.length
        ? raw.accounts!.sectionOrder
        : DEFAULT_DASHBOARD_PREFERENCES.accounts.sectionOrder,
      hiddenSections: Array.isArray(raw.accounts?.hiddenSections) ? raw.accounts!.hiddenSections : [],
    },
  };
}

export const fmt = (ts?: number) => (!ts ? "-" : new Date(ts).toLocaleString());
export const clampPct = (v: number) => Math.max(0, Math.min(100, v));
export const compactNumber = (v: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
export const usd = (v: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);

export function formatTokenCount(v: number): string {
  const n = Number.isFinite(v) ? Math.max(0, v) : 0;
  if (n < 1_000) return `${Math.round(n)}`;

  const units = [
    { value: 1_000_000_000, suffix: "B" },
    { value: 1_000_000, suffix: "M" },
    { value: 1_000, suffix: "K" },
  ];
  const unit = units.find((u) => n >= u.value) ?? units[units.length - 1];
  const scaled = n / unit.value;
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  const text = Number.isInteger(rounded) ? `${rounded}` : `${rounded.toFixed(1)}`;
  return `${text.replace(/\.0$/, "")}${unit.suffix}`;
}

export function routeLabel(v: string) {
  if (v.includes("chat/completions")) return "chat/completions";
  if (v.includes("responses")) return "responses";
  return v;
}

export function maskEmail(v?: string) {
  if (!v) return "hidden@email";
  return "*";
}

export function maskId(v?: string) {
  if (!v) return "acc-xxxx";
  return "*";
}

export function formatSessionTail(v?: string) {
  const value = String(v ?? "").trim();
  if (!value) return "-";
  return value.length <= 8 ? value : `...${value.slice(-8)}`;
}
