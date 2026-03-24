import type {
  AccountsSectionId,
  DashboardPreferences,
  DashboardRangePreset,
  DashboardTabId,
  TopSessionsSortDirection,
  TopSessionsSortKey,
  TopSessionsSortState,
  TracingCardId,
} from "./types.js";

export const DEFAULT_TAB_ORDER: DashboardTabId[] = [
  "overview",
  "accounts",
  "aliases",
  "tracing",
  "playground",
  "docs",
];

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

export const DEFAULT_TOP_SESSIONS_SORT: TopSessionsSortState = {
  key: "requests",
  direction: "desc",
};

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

const VALID_RANGES = new Set<DashboardRangePreset>(["24h", "7d", "30d", "all"]);
const VALID_TABS = new Set<DashboardTabId>(DEFAULT_TAB_ORDER);
const VALID_TRACING_CARDS = new Set<TracingCardId>(DEFAULT_TRACING_CARD_ORDER);
const VALID_ACCOUNT_SECTIONS = new Set<AccountsSectionId>(DEFAULT_ACCOUNTS_SECTION_ORDER);
const VALID_TOP_SESSION_KEYS = new Set<TopSessionsSortKey>([
  "requests",
  "tokens",
  "costUsd",
  "avgLatencyMs",
  "lastAt",
]);
const VALID_TOP_SESSION_DIRECTIONS = new Set<TopSessionsSortDirection>(["asc", "desc"]);

function normalizeOrderedList<T extends string>(input: unknown, defaults: T[], valid: Set<T>): T[] {
  const raw = Array.isArray(input) ? input : [];
  const ordered: T[] = [];

  for (const entry of raw) {
    if (typeof entry !== "string" || !valid.has(entry as T)) continue;
    const item = entry as T;
    if (!ordered.includes(item)) ordered.push(item);
  }

  for (const item of defaults) {
    if (!ordered.includes(item)) ordered.push(item);
  }

  return ordered;
}

function normalizeSubset<T extends string>(input: unknown, valid: Set<T>): T[] {
  const raw = Array.isArray(input) ? input : [];
  const next: T[] = [];

  for (const entry of raw) {
    if (typeof entry !== "string" || !valid.has(entry as T)) continue;
    const item = entry as T;
    if (!next.includes(item)) next.push(item);
  }

  return next;
}

function normalizeRange(input: unknown, fallback: DashboardRangePreset): DashboardRangePreset {
  return typeof input === "string" && VALID_RANGES.has(input as DashboardRangePreset)
    ? (input as DashboardRangePreset)
    : fallback;
}

function normalizeTopSessionsSort(input: unknown): TopSessionsSortState {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const key =
    typeof raw.key === "string" && VALID_TOP_SESSION_KEYS.has(raw.key as TopSessionsSortKey)
      ? (raw.key as TopSessionsSortKey)
      : DEFAULT_TOP_SESSIONS_SORT.key;
  const direction =
    typeof raw.direction === "string" &&
    VALID_TOP_SESSION_DIRECTIONS.has(raw.direction as TopSessionsSortDirection)
      ? (raw.direction as TopSessionsSortDirection)
      : DEFAULT_TOP_SESSIONS_SORT.direction;
  return { key, direction };
}

export function normalizeDashboardPreferences(input: unknown): DashboardPreferences {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const ranges = raw.ranges && typeof raw.ranges === "object" ? (raw.ranges as Record<string, unknown>) : {};
  const tracing = raw.tracing && typeof raw.tracing === "object" ? (raw.tracing as Record<string, unknown>) : {};
  const accounts = raw.accounts && typeof raw.accounts === "object" ? (raw.accounts as Record<string, unknown>) : {};

  return {
    tabOrder: normalizeOrderedList(raw.tabOrder, DEFAULT_TAB_ORDER, VALID_TABS),
    ranges: {
      overview: normalizeRange(ranges.overview, DEFAULT_DASHBOARD_PREFERENCES.ranges.overview),
      accounts: normalizeRange(ranges.accounts, DEFAULT_DASHBOARD_PREFERENCES.ranges.accounts),
      tracing: normalizeRange(ranges.tracing, DEFAULT_DASHBOARD_PREFERENCES.ranges.tracing),
    },
    tracing: {
      cardOrder: normalizeOrderedList(
        tracing.cardOrder,
        DEFAULT_TRACING_CARD_ORDER,
        VALID_TRACING_CARDS,
      ),
      hiddenCards: normalizeSubset(tracing.hiddenCards, VALID_TRACING_CARDS),
      graphsHidden: tracing.graphsHidden === true,
      topSessionsSort: normalizeTopSessionsSort(tracing.topSessionsSort),
    },
    accounts: {
      sectionOrder: normalizeOrderedList(
        accounts.sectionOrder,
        DEFAULT_ACCOUNTS_SECTION_ORDER,
        VALID_ACCOUNT_SECTIONS,
      ),
      hiddenSections: normalizeSubset(accounts.hiddenSections, VALID_ACCOUNT_SECTIONS),
    },
  };
}

export function mergeDashboardPreferences(
  current: DashboardPreferences,
  patch: unknown,
): DashboardPreferences {
  const raw = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  const rawTracing =
    raw.tracing && typeof raw.tracing === "object"
      ? (raw.tracing as Record<string, unknown>)
      : {};
  const rawTracingSort =
    rawTracing.topSessionsSort && typeof rawTracing.topSessionsSort === "object"
      ? (rawTracing.topSessionsSort as Record<string, unknown>)
      : {};
  const currentNormalized = normalizeDashboardPreferences(current);
  const next = {
    ...currentNormalized,
    ...raw,
    ranges: {
      ...currentNormalized.ranges,
      ...(raw.ranges && typeof raw.ranges === "object" ? raw.ranges : {}),
    },
    tracing: {
      ...currentNormalized.tracing,
      ...rawTracing,
      topSessionsSort: {
        ...currentNormalized.tracing.topSessionsSort,
        ...rawTracingSort,
      },
    },
    accounts: {
      ...currentNormalized.accounts,
      ...(raw.accounts && typeof raw.accounts === "object" ? raw.accounts : {}),
    },
  };
  return normalizeDashboardPreferences(next);
}
