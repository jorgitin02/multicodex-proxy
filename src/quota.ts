import type {
  Account,
  ProviderId,
  ProxyRoutingMode,
  QuotaProfile,
  UsageSnapshot,
  UsageWindow,
} from "./types.js";
import { MODEL_COMPATIBILITY_TTL_MS } from "./config.js";

export const USAGE_CACHE_TTL_MS = Number(
  process.env.USAGE_CACHE_TTL_MS ?? 300_000,
);
const USAGE_TIMEOUT_MS = Number(process.env.USAGE_TIMEOUT_MS ?? 10_000);
const BLOCK_FALLBACK_MS = Number(process.env.BLOCK_FALLBACK_MS ?? 30 * 60_000);
const DEFAULT_ROUTING_WINDOW_MS = Number(process.env.ROUTING_WINDOW_MS ?? 0);
const AUTH_FALLBACK_MS = Number(process.env.AUTH_FALLBACK_MS ?? 60 * 60_000);

type RouteCache = {
  accountId?: string;
  bucketByWindowMs: Map<number, number>;
  roundRobinAccountIdByProvider: Map<ProviderId, string>;
};

const routeCache: RouteCache = {
  accountId: undefined,
  bucketByWindowMs: new Map(),
  roundRobinAccountIdByProvider: new Map(),
};

export function resetRoutingStateForTest() {
  routeCache.accountId = undefined;
  routeCache.bucketByWindowMs.clear();
  routeCache.roundRobinAccountIdByProvider.clear();
}

export function normalizeProvider(account?: Account): ProviderId {
  return account?.provider === "mistral" ? "mistral" : "openai";
}

function nowBucket(now: number, windowMs: number) {
  return Math.floor(now / windowMs);
}

function safePct(v?: number): number {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function hasUsageWindow(window?: UsageWindow): boolean {
  return (
    typeof window?.usedPercent === "number" ||
    typeof window?.resetAt === "number"
  );
}

function inferQuotaProfile(
  account: Account,
): Exclude<QuotaProfile, "auto"> | undefined {
  if (account.quotaProfile && account.quotaProfile !== "auto") {
    return account.quotaProfile;
  }
  if (account.usage?.profile) return account.usage.profile;
  if (
    hasUsageWindow(account.usage?.primary) &&
    hasUsageWindow(account.usage?.secondary)
  ) {
    return "windowed_and_weekly";
  }
  if (
    !hasUsageWindow(account.usage?.primary) &&
    hasUsageWindow(account.usage?.secondary)
  ) {
    return "weekly_only";
  }
  if (hasUsageWindow(account.usage?.primary)) {
    return "windowed_and_weekly";
  }
  return undefined;
}

function relevantUsageWindowsForAccount(account: Account): UsageWindow[] {
  const profile = inferQuotaProfile(account);
  if (profile === "weekly_only") {
    return account.usage?.secondary ? [account.usage.secondary] : [];
  }
  return [account.usage?.primary, account.usage?.secondary].filter(
    (window): window is UsageWindow => hasUsageWindow(window),
  );
}

function relevantUsagePercents(account: Account): number[] {
  return relevantUsageWindowsForAccount(account).map((window) =>
    safePct(window.usedPercent),
  );
}

function scoreAccount(account: Account): number {
  const values = relevantUsagePercents(account);
  if (!values.length) return 0;

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const imbalance =
    values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
  return mean + imbalance * 0.25;
}

function parseUsage(data: any, account?: Account): UsageSnapshot {
  const primary = data?.rate_limit?.primary_window;
  const secondary = data?.rate_limit?.secondary_window;
  const toWindow = (w: any) =>
    w
      ? {
          usedPercent:
            typeof w.used_percent === "number"
              ? Math.max(0, Math.min(100, w.used_percent))
              : undefined,
          resetAt:
            typeof w.reset_at === "number" ? w.reset_at * 1000 : undefined,
        }
      : undefined;
  const snapshot: UsageSnapshot = {
    primary: toWindow(primary),
    secondary: toWindow(secondary),
    fetchedAt: Date.now(),
  };
  const inferredProfile =
    account?.quotaProfile && account.quotaProfile !== "auto"
      ? account.quotaProfile
      : !snapshot.primary && snapshot.secondary
        ? "weekly_only"
        : snapshot.primary
          ? "windowed_and_weekly"
          : undefined;
  return {
    ...snapshot,
    profile: inferredProfile,
  };
}

function parseOpenAIUsage(data: any, account?: Account): UsageSnapshot {
  return parseUsage(data, account);
}

export function rememberError(account: Account, message: string) {
  const next = [
    { at: Date.now(), message },
    ...(account.state?.recentErrors ?? []),
  ].slice(0, 10);
  account.state = { ...account.state, lastError: message, recentErrors: next };
}

function isAuthFailureReason(reason: unknown): reason is string {
  return typeof reason === "string" && /^auth failure:/i.test(reason);
}

function isAuthRelatedErrorMessage(message: unknown): message is string {
  return (
    typeof message === "string" &&
    /^(auth failure:|refresh token failed:|usage probe failed 401\b)/i.test(
      message,
    )
  );
}

export function clearAuthFailureState(account: Account) {
  const current = account.state;
  if (!current) return;

  const blockedByAuth = isAuthFailureReason(current.blockedReason);
  const recentErrors = (current.recentErrors ?? []).filter(
    (entry) => !isAuthRelatedErrorMessage(entry?.message),
  );
  const lastError = isAuthRelatedErrorMessage(current.lastError)
    ? undefined
    : current.lastError;

  account.state = {
    ...current,
    blockedUntil: blockedByAuth ? undefined : current.blockedUntil,
    blockedReason: blockedByAuth ? undefined : current.blockedReason,
    needsTokenRefresh: false,
    refreshFailureCount: 0,
    refreshBlockedUntil: undefined,
    lastError,
    recentErrors: recentErrors.length ? recentErrors : undefined,
  };
}

export function usageUntouched(
  usage?: UsageSnapshot,
  account?: Account,
): boolean {
  const effectiveAccount = account ?? {
    id: "usage",
    enabled: true,
    accessToken: "",
    usage,
  };
  const values = relevantUsagePercents(effectiveAccount as Account);
  return values.length > 0 && values.every((value) => value === 0);
}

export function weeklyResetAt(
  usage?: UsageSnapshot,
  account?: Account,
): number | undefined {
  const effectiveAccount = account ?? {
    id: "usage",
    enabled: true,
    accessToken: "",
    usage,
  };
  const profile = inferQuotaProfile(effectiveAccount as Account);
  if (profile === "weekly_only" || profile === "windowed_and_weekly") {
    return usage?.secondary?.resetAt;
  }
  return usage?.secondary?.resetAt;
}

export function nextResetAt(
  usage?: UsageSnapshot,
  account?: Account,
): number | undefined {
  const effectiveAccount = account ?? {
    id: "usage",
    enabled: true,
    accessToken: "",
    usage,
  };
  const windows = relevantUsageWindowsForAccount(effectiveAccount as Account);
  const list = windows
    .map((window) => window.resetAt)
    .filter((x): x is number => typeof x === "number");
  return list.length ? Math.min(...list) : undefined;
}

export function isQuotaErrorText(s: string): boolean {
  return /\b429\b|quota|usage limit|rate.?limit|too many requests|limit reached|capacity/i.test(
    s,
  );
}

export function accountUsable(a: Account): boolean {
  if (!a.enabled) return false;
  const until = a.state?.blockedUntil;
  return !(typeof until === "number" && Date.now() < until);
}

function normalizeModelKey(model?: string): string {
  const raw = (model ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (!raw.includes("/")) return raw;
  return raw.split("/").pop() ?? raw;
}

export function accountSupportsModel(
  account: Account,
  model?: string,
): boolean {
  const key = normalizeModelKey(model);
  if (!key) return true;
  const record = account.state?.modelAvailability?.[key];
  if (!record) return true;
  if (Date.now() - record.checkedAt > MODEL_COMPATIBILITY_TTL_MS) return true;
  return record.supported;
}

export function markModelCompatibility(
  account: Account,
  model: string | undefined,
  supported: boolean,
  reason?: string,
) {
  const key = normalizeModelKey(model);
  if (!key) return;
  account.state = {
    ...account.state,
    modelAvailability: {
      ...(account.state?.modelAvailability ?? {}),
      [key]: {
        supported,
        checkedAt: Date.now(),
        reason,
      },
    },
  };
}

type ChooseAccountOptions = {
  routingMode?: ProxyRoutingMode;
  provider?: ProviderId;
};

export function chooseAccount(
  accounts: Account[],
  options: ChooseAccountOptions = {},
): Account | null {
  const now = Date.now();
  const routingMode = options.routingMode ?? "quota_aware";
  const windowMs =
    Number.isFinite(DEFAULT_ROUTING_WINDOW_MS) && DEFAULT_ROUTING_WINDOW_MS > 0
      ? DEFAULT_ROUTING_WINDOW_MS
      : 0;

  const available = accounts.filter((a) => {
    if (!a.enabled) return false;
    const blockedUntil = a.state?.blockedUntil ?? 0;
    return blockedUntil <= now;
  });
  if (!available.length) return null;

  if (routingMode === "round_robin") {
    const providerKey = options.provider ?? normalizeProvider(available[0]);
    const sorted = [...available].sort((a, b) => {
      const ap = a.priority ?? Number.MAX_SAFE_INTEGER;
      const bp = b.priority ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return a.id.localeCompare(b.id);
    });
    const previousId =
      routeCache.roundRobinAccountIdByProvider.get(providerKey);
    const previousIndex = previousId
      ? sorted.findIndex((account) => account.id === previousId)
      : -1;
    const winner =
      sorted[(previousIndex + 1 + sorted.length) % sorted.length] ?? null;
    if (winner) {
      routeCache.roundRobinAccountIdByProvider.set(providerKey, winner.id);
    }
    return winner;
  }

  if (windowMs > 0) {
    const bucket = nowBucket(now, windowMs);
    const stickyBucket = routeCache.bucketByWindowMs.get(windowMs);
    if (stickyBucket === bucket && routeCache.accountId) {
      const sticky = available.find((a) => a.id === routeCache.accountId);
      if (sticky) return sticky;
    }
  }

  const untouched = available.filter((a) => usageUntouched(a.usage, a));

  const pool = untouched.length ? untouched : available;

  const sorted = [...pool].sort((a, b) => {
    const ap = a.priority ?? Number.MAX_SAFE_INTEGER;
    const bp = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;

    const al = a.state?.lastSelectedAt ?? 0;
    const bl = b.state?.lastSelectedAt ?? 0;
    if (al !== bl) return al - bl;

    const sa = scoreAccount(a);
    const sb = scoreAccount(b);
    if (sa !== sb) return sa - sb;

    const ar = a.usage?.secondary?.resetAt ?? Number.MAX_SAFE_INTEGER;
    const br = b.usage?.secondary?.resetAt ?? Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;

    return a.id.localeCompare(b.id);
  });

  const winner = sorted[0] ?? null;
  routeCache.accountId = winner?.id;
  if (windowMs > 0 && winner) {
    routeCache.bucketByWindowMs.set(windowMs, nowBucket(now, windowMs));
  }

  return winner;
}

export function chooseAccountForProvider(
  accounts: Account[],
  provider: ProviderId,
  options: Omit<ChooseAccountOptions, "provider"> = {},
): Account | null {
  return chooseAccount(
    accounts.filter((a) => normalizeProvider(a) === provider),
    {
      ...options,
      provider,
    },
  );
}

type RefreshUsageOptions = {
  requireAccountScope?: boolean;
};

export async function refreshUsageIfNeeded(
  account: Account,
  chatgptBaseUrl: string,
  force = false,
  options: RefreshUsageOptions = {},
): Promise<Account> {
  if (
    !force &&
    account.usage &&
    Date.now() - account.usage.fetchedAt < USAGE_CACHE_TTL_MS
  )
    return account;
  const provider = normalizeProvider(account);
  const now = Date.now();
  if (provider === "mistral") {
    account.usage = {
      ...account.usage,
      fetchedAt: now,
      scope: "unsupported",
      degradedReason:
        "Provider quota refresh is not implemented for Mistral accounts.",
    };
    return account;
  }

  if (!account.chatgptAccountId && options.requireAccountScope) {
    account.usage = {
      ...account.usage,
      fetchedAt: now,
      scope: "unscoped",
      degradedReason:
        "Missing ChatGPT account ID; provider quota cannot be refreshed reliably for this account.",
    };
    account.state = {
      ...account.state,
      lastUsageRefreshAt: now,
    };
    return account;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${account.accessToken}`,
      Accept: "application/json",
    };
    const usageUrl = `${chatgptBaseUrl}/backend-api/wham/usage`;
    if (provider === "openai" && account.chatgptAccountId) {
      headers["ChatGPT-Account-Id"] = account.chatgptAccountId;
    }
    const res = await fetch(usageUrl, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`usage probe failed ${res.status}`);
    const json = await res.json();
    account.usage = {
      ...parseOpenAIUsage(json, account),
      scope: account.chatgptAccountId ? "account" : "unscoped",
      degradedReason: account.chatgptAccountId
        ? undefined
        : "Missing ChatGPT account ID; provider quota may not match this account.",
    };
    clearAuthFailureState(account);
    account.state = {
      ...account.state,
      lastError: undefined,
      lastUsageRefreshAt: now,
    };
    return account;
  } catch (err: any) {
    rememberError(account, err?.message ?? String(err));
    return account;
  } finally {
    clearTimeout(timeout);
  }
}

export function markQuotaHit(account: Account, message: string) {
  const until =
    nextResetAt(account.usage, account) ?? Date.now() + BLOCK_FALLBACK_MS;
  account.state = {
    ...account.state,
    blockedUntil: until,
    blockedReason: message,
  };
  rememberError(account, message);
}

export function markAuthFailure(account: Account, message: string) {
  account.state = {
    ...account.state,
    blockedUntil: Date.now() + AUTH_FALLBACK_MS,
    blockedReason: message,
    needsTokenRefresh: true,
  };
  rememberError(account, message);
}

export function markModelUnsupported(account: Account, message: string) {
  const modelMatch = message.match(/for ([^:]+):/);
  markModelCompatibility(account, modelMatch?.[1], false, message);
  rememberError(account, message);
}
