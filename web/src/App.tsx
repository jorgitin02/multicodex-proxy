import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { estimateCostUsd } from "./model-pricing";
import { api, tokenDefault } from "./lib/api";
import {
  DEFAULT_ACCOUNTS_SECTION_ORDER,
  DEFAULT_DASHBOARD_PREFERENCES,
  DEFAULT_TAB_ORDER,
  DEFAULT_TOP_SESSIONS_SORT,
  DEFAULT_TRACING_CARD_ORDER,
  EMPTY_TRACE_PAGINATION,
  EMPTY_TRACE_STATS,
  EMPTY_TRACE_USAGE_STATS,
  TRACE_PAGE_SIZE,
  normalizeDashboardPreferences,
} from "./lib/ui";
import type {
  Account,
  AccountsSectionId,
  DashboardPreferences,
  ExposedModel,
  ModelAlias,
  ProxySettings,
  Tab,
  Trace,
  TracePagination,
  TraceRangePreset,
  TraceStats,
  TraceUsageStats,
  TracingCardId,
} from "./types";
import { AccountsTab } from "./components/tabs/AccountsTab";
import { DocsTab } from "./components/tabs/DocsTab";
import { OverviewTab } from "./components/tabs/OverviewTab";
import { PlaygroundTab } from "./components/tabs/PlaygroundTab";
import { TracingTab } from "./components/tabs/TracingTab";
import { AliasesTab } from "./components/tabs/AliasesTab";

const q = new URLSearchParams(window.location.search);
const initialTab = (q.get("tab") as Tab) || "overview";
const BASE_REFRESH_MS = 60_000;
const ACTIVE_TAB_REFRESH_MS = 30_000;

function getRangeBounds(range: TraceRangePreset): {
  sinceMs?: number;
  untilMs?: number;
} {
  const now = Date.now();
  if (range === "24h")
    return { sinceMs: now - 24 * 60 * 60 * 1000, untilMs: now };
  if (range === "7d")
    return { sinceMs: now - 7 * 24 * 60 * 60 * 1000, untilMs: now };
  if (range === "30d")
    return { sinceMs: now - 30 * 24 * 60 * 60 * 1000, untilMs: now };
  return {};
}

function buildRangeParams(range: TraceRangePreset) {
  const { sinceMs, untilMs } = getRangeBounds(range);
  const params = new URLSearchParams();
  if (typeof sinceMs === "number") params.set("sinceMs", String(sinceMs));
  if (typeof untilMs === "number") params.set("untilMs", String(untilMs));
  return params;
}

function filterTraceStatsForModels(
  input: TraceStats,
  models: ExposedModel[],
): TraceStats {
  if (!input.models.length) return input;
  if (!models.length) return { ...input, models: [] };
  const allowed = new Set(models.map((m) => m.id));
  return {
    ...input,
    models: input.models.filter(
      (model) => allowed.has(model.model) && model.okCount > 0,
    ),
  };
}

function moveItem<T extends string>(
  list: T[],
  item: T,
  direction: -1 | 1,
): T[] {
  const next = [...list];
  const currentIndex = next.indexOf(item);
  if (currentIndex < 0) return next;
  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= next.length) return next;
  [next[currentIndex], next[targetIndex]] = [
    next[targetIndex],
    next[currentIndex],
  ];
  return next;
}

function titleForTab(tab: Tab) {
  switch (tab) {
    case "overview":
      return "Overview";
    case "accounts":
      return "Accounts";
    case "aliases":
      return "Aliases";
    case "tracing":
      return "Tracing";
    case "playground":
      return "Playground";
    case "docs":
      return "Docs";
    default:
      return tab;
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [locationSearch, setLocationSearch] = useState(window.location.search);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [overviewTraceStats, setOverviewTraceStats] =
    useState<TraceStats>(EMPTY_TRACE_STATS);
  const [overviewUsageStats, setOverviewUsageStats] = useState<TraceUsageStats>(
    EMPTY_TRACE_USAGE_STATS,
  );
  const [accountsTraceStats, setAccountsTraceStats] =
    useState<TraceStats>(EMPTY_TRACE_STATS);
  const [accountsUsageStats, setAccountsUsageStats] = useState<TraceUsageStats>(
    EMPTY_TRACE_USAGE_STATS,
  );
  const [tracingTraceStats, setTracingTraceStats] =
    useState<TraceStats>(EMPTY_TRACE_STATS);
  const [tracingUsageStats, setTracingUsageStats] = useState<TraceUsageStats>(
    EMPTY_TRACE_USAGE_STATS,
  );
  const [tracePagination, setTracePagination] = useState<TracePagination>(
    EMPTY_TRACE_PAGINATION,
  );
  const [models, setModels] = useState<ExposedModel[]>([]);
  const [aliases, setAliases] = useState<ModelAlias[]>([]);
  const [dashboardPreferences, setDashboardPreferences] =
    useState<DashboardPreferences>(DEFAULT_DASHBOARD_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [tabLayoutEditMode, setTabLayoutEditMode] = useState(false);
  const [adminToken, setAdminToken] = useState(
    localStorage.getItem("adminToken") ?? tokenDefault,
  );
  const [storageInfo, setStorageInfo] = useState<any>(null);
  const [oauthRedirectUri, setOauthRedirectUri] = useState("");
  const [proxySettings, setProxySettings] = useState<ProxySettings>({
    routingMode: "quota_aware",
  });
  const [chatPrompt, setChatPrompt] = useState("Give me a one-line hello");
  const [chatOut, setChatOut] = useState("");
  const [error, setError] = useState("");
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [expandedTrace, setExpandedTrace] = useState<Trace | null>(null);
  const [expandedTraceLoading, setExpandedTraceLoading] = useState(false);
  const [traceExportInProgress, setTraceExportInProgress] = useState(false);
  const tracePageRef = useRef(tracePagination.page);
  const preferenceSaveQueueRef = useRef(Promise.resolve());
  const sanitized = useMemo(() => {
    const params = new URLSearchParams(locationSearch);
    return params.get("sanitized") === "1" || params.get("safe") === "1";
  }, [locationSearch]);

  const overviewRange = dashboardPreferences.ranges.overview;
  const accountsRange = dashboardPreferences.ranges.accounts;
  const tracingRange = dashboardPreferences.ranges.tracing;
  const orderedTabs = dashboardPreferences.tabOrder as Tab[];

  const stats = useMemo(
    () => ({
      total: accounts.length,
      enabled: accounts.filter((account) => account.enabled).length,
      blocked: accounts.filter(
        (account) =>
          account.state?.blockedUntil &&
          account.state.blockedUntil > Date.now(),
      ).length,
    }),
    [accounts],
  );

  const providerQuotaStats = useMemo(() => {
    const primary = accounts
      .map((account) => account.usage?.primary?.usedPercent)
      .filter((value): value is number => typeof value === "number");
    const secondary = accounts
      .map((account) => account.usage?.secondary?.usedPercent)
      .filter((value): value is number => typeof value === "number");
    const avg = (values: number[]) =>
      values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;
    const accountScoped = accounts.filter(
      (account) => account.usage?.scope === "account",
    ).length;
    const degraded = accounts.filter(
      (account) => account.usage?.scope === "unscoped",
    ).length;
    const unsupported = accounts.filter(
      (account) => account.usage?.scope === "unsupported",
    ).length;
    const freshestAt = accounts.reduce(
      (latest, account) => Math.max(latest, account.usage?.fetchedAt ?? 0),
      0,
    );

    return {
      primaryAvg: avg(primary),
      secondaryAvg: avg(secondary),
      primaryCount: primary.length,
      secondaryCount: secondary.length,
      accountScoped,
      degraded,
      unsupported,
      freshestAt,
    };
  }, [accounts]);

  const filteredOverviewTraceStats = useMemo(
    () => filterTraceStatsForModels(overviewTraceStats, models),
    [models, overviewTraceStats],
  );
  const filteredAccountsTraceStats = useMemo(
    () => filterTraceStatsForModels(accountsTraceStats, models),
    [accountsTraceStats, models],
  );
  const filteredTracingTraceStats = useMemo(
    () => filterTraceStatsForModels(tracingTraceStats, models),
    [models, tracingTraceStats],
  );

  const modelChartData = useMemo(
    () =>
      filteredTracingTraceStats.models
        .slice(0, 8)
        .map((model) => ({ ...model, label: model.model })),
    [filteredTracingTraceStats.models],
  );
  const modelCostChartData = useMemo(
    () =>
      [...filteredTracingTraceStats.models]
        .sort((a, b) => b.costUsd - a.costUsd)
        .slice(0, 8)
        .map((model) => ({ ...model, label: model.model })),
    [filteredTracingTraceStats.models],
  );
  const tokensTimeseries = useMemo(
    () =>
      filteredTracingTraceStats.timeseries.map((bucket) => ({
        ...bucket,
        label:
          tracingRange === "24h"
            ? new Date(bucket.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : new Date(bucket.at).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
      })),
    [filteredTracingTraceStats.timeseries, tracingRange],
  );
  const totalTraceCostFromRows = useMemo(
    () =>
      traces.reduce(
        (sum, trace) =>
          sum +
          (typeof trace.costUsd === "number"
            ? trace.costUsd
            : (estimateCostUsd(
                trace.model,
                trace.tokensInput ?? 0,
                trace.tokensOutput ?? 0,
              ) ?? 0)),
        0,
      ),
    [traces],
  );

  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("tab", tab);
    window.history.replaceState({}, "", u.toString());
    setLocationSearch(u.search);
  }, [tab]);

  useEffect(() => {
    const onPopstate = () => setLocationSearch(window.location.search);
    window.addEventListener("popstate", onPopstate);
    return () => window.removeEventListener("popstate", onPopstate);
  }, []);

  useEffect(() => {
    tracePageRef.current = tracePagination.page;
  }, [tracePagination.page]);

  const loadBase = async () => {
    const [acc, cfg, mdl, aliasRes] = await Promise.all([
      api("/admin/accounts"),
      api("/admin/config"),
      fetch("/v1/models").then((response) => response.json()),
      api("/admin/model-aliases"),
    ]);
    setAccounts((acc.accounts ?? []) as Account[]);
    setStorageInfo(cfg.storage ?? null);
    setOauthRedirectUri(String(cfg.oauthRedirectUri ?? ""));
    setProxySettings(
      (cfg.proxySettings ?? { routingMode: "quota_aware" }) as ProxySettings,
    );
    setModels((mdl.data ?? []) as ExposedModel[]);
    setAliases((aliasRes.modelAliases ?? []) as ModelAlias[]);
  };

  const loadPreferences = async () => {
    const res = await api("/admin/dashboard-preferences");
    setDashboardPreferences(normalizeDashboardPreferences(res.preferences));
    setPreferencesLoaded(true);
  };

  const enqueuePreferenceSave = (next: DashboardPreferences) => {
    preferenceSaveQueueRef.current = preferenceSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const res = await api("/admin/dashboard-preferences", {
            method: "PATCH",
            body: JSON.stringify(next),
          });
          setDashboardPreferences(
            normalizeDashboardPreferences(res.preferences),
          );
        } catch (e: any) {
          setError(e?.message ?? String(e));
        }
      });
  };

  const updateDashboardPreferences = (
    updater: (current: DashboardPreferences) => DashboardPreferences,
  ) => {
    let next: DashboardPreferences | undefined;
    setDashboardPreferences((current) => {
      next = normalizeDashboardPreferences(updater(current));
      return next;
    });
    if (next) enqueuePreferenceSave(next);
  };

  const loadOverviewAnalytics = async (range: TraceRangePreset) => {
    const params = buildRangeParams(range);
    const [statsRes, usageRes] = await Promise.all([
      api(`/admin/stats/traces?${params.toString()}`),
      api(`/admin/stats/usage?${params.toString()}`),
    ]);
    setOverviewTraceStats((statsRes.stats ?? EMPTY_TRACE_STATS) as TraceStats);
    setOverviewUsageStats(
      (usageRes ?? EMPTY_TRACE_USAGE_STATS) as TraceUsageStats,
    );
  };

  const loadAccountsAnalytics = async (range: TraceRangePreset) => {
    const params = buildRangeParams(range);
    const [statsRes, usageRes] = await Promise.all([
      api(`/admin/stats/traces?${params.toString()}`),
      api(`/admin/stats/usage?${params.toString()}`),
    ]);
    setAccountsTraceStats((statsRes.stats ?? EMPTY_TRACE_STATS) as TraceStats);
    setAccountsUsageStats(
      (usageRes ?? EMPTY_TRACE_USAGE_STATS) as TraceUsageStats,
    );
  };

  const loadTracing = async (
    page: number,
    range: TraceRangePreset = tracingRange,
  ) => {
    const safePage = Math.max(1, page || 1);
    const params = buildRangeParams(range);
    params.set("page", String(safePage));
    params.set("pageSize", String(TRACE_PAGE_SIZE));

    const [tr, statsRes, usageRes] = await Promise.all([
      api(`/admin/traces?${params.toString()}`),
      api(`/admin/stats/traces?${params.toString()}`),
      api(`/admin/stats/usage?${params.toString()}`),
    ]);

    setTraces((tr.traces ?? []) as Trace[]);
    setTracingTraceStats(
      (statsRes.stats ?? tr.stats ?? EMPTY_TRACE_STATS) as TraceStats,
    );
    setTracingUsageStats(
      (usageRes ?? EMPTY_TRACE_USAGE_STATS) as TraceUsageStats,
    );
    setTracePagination(
      (tr.pagination ?? {
        ...EMPTY_TRACE_PAGINATION,
        page: safePage,
      }) as TracePagination,
    );
    setExpandedTraceId(null);
    setExpandedTrace(null);
  };

  const refreshActiveTab = async (activeTab: Tab = tab) => {
    if (activeTab === "overview") {
      await loadOverviewAnalytics(overviewRange);
      return;
    }
    if (activeTab === "accounts") {
      await loadAccountsAnalytics(accountsRange);
      return;
    }
    if (activeTab === "tracing") {
      await loadTracing(tracePageRef.current, tracingRange);
    }
  };

  const refreshData = async () => {
    try {
      setError("");
      await loadBase();
      if (preferencesLoaded) {
        await refreshActiveTab();
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        setError("");
        await Promise.all([loadBase(), loadPreferences()]);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const load = async () => {
      try {
        setError("");
        await refreshActiveTab();
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    };
    void load();
  }, [preferencesLoaded, tab, overviewRange, accountsRange, tracingRange]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const timer = window.setInterval(() => {
      void loadBase().catch((e: any) => setError(e?.message ?? String(e)));
    }, BASE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [preferencesLoaded]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const timer = window.setInterval(() => {
      void refreshActiveTab().catch((e: any) =>
        setError(e?.message ?? String(e)),
      );
    }, ACTIVE_TAB_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [preferencesLoaded, tab, overviewRange, accountsRange, tracingRange]);

  const patch = async (id: string, body: any) => {
    await api(`/admin/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await refreshData();
  };

  const del = async (id: string) => {
    if (confirm("Delete account?")) {
      await api(`/admin/accounts/${id}`, { method: "DELETE" });
      await refreshData();
    }
  };

  const unblock = async (id: string) => {
    await api(`/admin/accounts/${id}/unblock`, { method: "POST" });
    await refreshData();
  };

  const refreshUsage = async (id: string) => {
    await api(`/admin/accounts/${id}/refresh-usage`, { method: "POST" });
    await refreshData();
  };

  const createAccount = async (body: any) => {
    await api("/admin/accounts", {
      method: "POST",
      body: JSON.stringify(body),
    });
    await refreshData();
  };

  const patchProxySettings = async (body: Partial<ProxySettings>) => {
    const res = await api("/admin/config", {
      method: "PATCH",
      body: JSON.stringify({ proxySettings: body }),
    });
    setProxySettings(
      (res.proxySettings ?? { routingMode: "quota_aware" }) as ProxySettings,
    );
    await refreshData();
  };

  const startOAuth = async (email: string, accountId?: string) =>
    api("/admin/oauth/start", {
      method: "POST",
      body: JSON.stringify({ email, accountId }),
    });

  const completeOAuth = async (flowId: string, input: string) => {
    const result = await api("/admin/oauth/complete", {
      method: "POST",
      body: JSON.stringify({ flowId, input }),
    });
    await refreshData();
    return result;
  };

  const saveAlias = async (body: {
    id: string;
    targets: string[];
    enabled?: boolean;
    description?: string;
  }) => {
    await api("/admin/model-aliases", {
      method: "POST",
      body: JSON.stringify(body),
    });
    await refreshData();
  };

  const patchAlias = async (id: string, body: Partial<ModelAlias>) => {
    await api(`/admin/model-aliases/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await refreshData();
  };

  const deleteAlias = async (id: string) => {
    if (confirm("Delete model alias?")) {
      await api(`/admin/model-aliases/${id}`, { method: "DELETE" });
      await refreshData();
    }
  };

  const runChatTest = async () => {
    setChatOut("Running...");
    const response = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: models[0]?.id || "gpt-5.3-codex",
        messages: [{ role: "user", content: chatPrompt }],
      }),
    });
    const body = await response.json();
    setChatOut(
      (body?.choices?.[0]?.message?.content as string) ||
        JSON.stringify(body, null, 2),
    );
  };

  const gotoTracePage = async (page: number) => {
    try {
      setError("");
      await loadTracing(page, tracingRange);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const toggleExpandedTrace = async (id: string) => {
    if (expandedTraceId === id) {
      setExpandedTraceId(null);
      setExpandedTrace(null);
      setExpandedTraceLoading(false);
      return;
    }

    setExpandedTraceId(id);
    setExpandedTrace(null);
    setExpandedTraceLoading(true);
    try {
      setError("");
      const res = await api(`/admin/traces/${encodeURIComponent(id)}`);
      setExpandedTrace((res.trace ?? null) as Trace | null);
    } catch (e: any) {
      setExpandedTraceId(null);
      setError(e?.message ?? String(e));
    } finally {
      setExpandedTraceLoading(false);
    }
  };

  const exportTracesZip = async () => {
    const params = buildRangeParams(tracingRange);
    const query = params.toString();
    const path = `/admin/traces/export.zip${query ? `?${query}` : ""}`;

    setTraceExportInProgress(true);
    try {
      setError("");
      const res = await fetch(path, {
        headers: {
          "x-admin-token": localStorage.getItem("adminToken") ?? tokenDefault,
        },
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const contentDisposition = res.headers.get("content-disposition") ?? "";
      const match = contentDisposition.match(/filename="([^"]+)"/);
      link.href = url;
      link.download = match?.[1] ?? "traces-export.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setTraceExportInProgress(false);
    }
  };

  const setTabRange = (
    key: "overview" | "accounts" | "tracing",
    range: TraceRangePreset,
  ) => {
    if (key === "tracing") {
      tracePageRef.current = 1;
      setTracePagination((current) => ({ ...current, page: 1 }));
    }
    updateDashboardPreferences((current) => ({
      ...current,
      ranges: {
        ...current.ranges,
        [key]: range,
      },
    }));
  };

  const moveTopTab = (tabId: Tab, direction: -1 | 1) => {
    updateDashboardPreferences((current) => ({
      ...current,
      tabOrder: moveItem(current.tabOrder as Tab[], tabId, direction),
    }));
  };

  const moveAccountsSection = (
    sectionId: AccountsSectionId,
    direction: -1 | 1,
  ) => {
    updateDashboardPreferences((current) => ({
      ...current,
      accounts: {
        ...current.accounts,
        sectionOrder: moveItem(
          current.accounts.sectionOrder,
          sectionId,
          direction,
        ),
      },
    }));
  };

  const toggleAccountsSectionHidden = (sectionId: AccountsSectionId) => {
    updateDashboardPreferences((current) => {
      const hidden = current.accounts.hiddenSections.includes(sectionId)
        ? current.accounts.hiddenSections.filter((entry) => entry !== sectionId)
        : [...current.accounts.hiddenSections, sectionId];
      return {
        ...current,
        accounts: {
          ...current.accounts,
          hiddenSections: hidden,
        },
      };
    });
  };

  const moveTracingCard = (cardId: TracingCardId, direction: -1 | 1) => {
    updateDashboardPreferences((current) => ({
      ...current,
      tracing: {
        ...current.tracing,
        cardOrder: moveItem(current.tracing.cardOrder, cardId, direction),
      },
    }));
  };

  const toggleTracingCardHidden = (cardId: TracingCardId) => {
    updateDashboardPreferences((current) => {
      const hidden = current.tracing.hiddenCards.includes(cardId)
        ? current.tracing.hiddenCards.filter((entry) => entry !== cardId)
        : [...current.tracing.hiddenCards, cardId];
      return {
        ...current,
        tracing: {
          ...current.tracing,
          hiddenCards: hidden,
        },
      };
    });
  };

  const setTracingGraphsHidden = (hidden: boolean) => {
    updateDashboardPreferences((current) => ({
      ...current,
      tracing: {
        ...current.tracing,
        graphsHidden: hidden,
      },
    }));
  };

  const setTopSessionsSort = (
    sort: DashboardPreferences["tracing"]["topSessionsSort"],
  ) => {
    updateDashboardPreferences((current) => ({
      ...current,
      tracing: {
        ...current.tracing,
        topSessionsSort: sort,
      },
    }));
  };

  const resetTabOrder = () => {
    updateDashboardPreferences((current) => ({
      ...current,
      tabOrder: DEFAULT_TAB_ORDER,
    }));
  };

  const resetAccountsLayout = () => {
    updateDashboardPreferences((current) => ({
      ...current,
      accounts: {
        sectionOrder: DEFAULT_ACCOUNTS_SECTION_ORDER,
        hiddenSections: [],
      },
    }));
  };

  const resetTracingLayout = () => {
    updateDashboardPreferences((current) => ({
      ...current,
      tracing: {
        cardOrder: DEFAULT_TRACING_CARD_ORDER,
        hiddenCards: [],
        graphsHidden: false,
        topSessionsSort: DEFAULT_TOP_SESSIONS_SORT,
      },
    }));
  };

  const tabOrderChanged = orderedTabs.some(
    (tabId, index) => tabId !== DEFAULT_TAB_ORDER[index],
  );

  return (
    <div className="page">
      <div className="shell">
        <header className="topbar panel">
          <div>
            <h1>Multivibe</h1>
            <p className="muted">
              Quota-aware, multi-provider router with OAuth onboarding and
              tracing.
            </p>
            <p className="muted">
              Active tab refreshes live every 10s. Layout and range preferences
              are saved globally.
            </p>
          </div>
          <div className="inline wrap">
            <input
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              onBlur={() => localStorage.setItem("adminToken", adminToken)}
              placeholder="Admin token"
            />
            <button
              className="btn secondary"
              onClick={() => void refreshData()}
            >
              Refresh data
            </button>
          </div>
        </header>

        <nav className="tabs panel">
          <div className="inline wrap row-between">
            <div className="inline wrap">
              {orderedTabs.map((tabId) => (
                <button
                  key={tabId}
                  className={tab === tabId ? "tab active" : "tab"}
                  onClick={() => setTab(tabId)}
                >
                  {titleForTab(tabId)}
                </button>
              ))}
            </div>
            <div className="inline wrap">
              <button
                className="btn ghost small"
                onClick={() => setTabLayoutEditMode((current) => !current)}
              >
                {tabLayoutEditMode ? "Done editing tabs" : "Edit tabs"}
              </button>
              <button
                className="btn secondary small"
                onClick={resetTabOrder}
                disabled={!tabOrderChanged}
              >
                Reset tabs
              </button>
            </div>
          </div>
          {tabLayoutEditMode && (
            <div className="layout-editor-list">
              {orderedTabs.map((tabId, index) => (
                <div key={tabId} className="layout-editor-row">
                  <span>{titleForTab(tabId)}</span>
                  <div className="inline wrap">
                    <button
                      className="btn ghost small"
                      onClick={() => moveTopTab(tabId, -1)}
                      disabled={index === 0}
                    >
                      Earlier
                    </button>
                    <button
                      className="btn ghost small"
                      onClick={() => moveTopTab(tabId, 1)}
                      disabled={index === orderedTabs.length - 1}
                    >
                      Later
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </nav>

        {tab === "overview" && (
          <OverviewTab
            stats={stats}
            providerQuotaStats={providerQuotaStats}
            traceStats={filteredOverviewTraceStats}
            traceUsageStats={overviewUsageStats}
            storageInfo={storageInfo}
            models={models}
            range={overviewRange}
            setRange={(range) => setTabRange("overview", range)}
          />
        )}

        {tab === "accounts" && (
          <AccountsTab
            range={accountsRange}
            setRange={(range) => setTabRange("accounts", range)}
            traceStats={filteredAccountsTraceStats}
            traceUsageStats={accountsUsageStats}
            providerQuotaStats={providerQuotaStats}
            accountsPreferences={dashboardPreferences.accounts}
            moveAccountsSection={moveAccountsSection}
            toggleAccountsSectionHidden={toggleAccountsSectionHidden}
            resetAccountsLayout={resetAccountsLayout}
            accounts={accounts}
            sanitized={sanitized}
            patch={patch}
            del={del}
            unblock={unblock}
            refreshUsage={refreshUsage}
            createAccount={createAccount}
            proxySettings={proxySettings}
            patchProxySettings={patchProxySettings}
            startOAuth={startOAuth}
            completeOAuth={completeOAuth}
            oauthRedirectUri={oauthRedirectUri}
          />
        )}

        {tab === "aliases" && (
          <AliasesTab
            aliases={aliases}
            saveAlias={saveAlias}
            patchAlias={patchAlias}
            deleteAlias={deleteAlias}
          />
        )}

        {tab === "tracing" && (
          <TracingTab
            accounts={accounts}
            traceStats={filteredTracingTraceStats}
            traceUsageStats={tracingUsageStats}
            tokensTimeseries={tokensTimeseries}
            modelChartData={modelChartData}
            modelCostChartData={modelCostChartData}
            tracePagination={tracePagination}
            gotoTracePage={gotoTracePage}
            traceRange={tracingRange}
            setTraceRange={(range) => setTabRange("tracing", range)}
            tracingPreferences={dashboardPreferences.tracing}
            moveTracingCard={moveTracingCard}
            toggleTracingCardHidden={toggleTracingCardHidden}
            setTracingGraphsHidden={setTracingGraphsHidden}
            setTopSessionsSort={setTopSessionsSort}
            resetTracingLayout={resetTracingLayout}
            traces={traces}
            expandedTraceId={expandedTraceId}
            expandedTrace={expandedTrace}
            expandedTraceLoading={expandedTraceLoading}
            toggleExpandedTrace={toggleExpandedTrace}
            sanitized={sanitized}
            exportTracesZip={exportTracesZip}
            exportInProgress={traceExportInProgress}
          />
        )}

        {tab === "playground" && (
          <PlaygroundTab
            chatPrompt={chatPrompt}
            setChatPrompt={setChatPrompt}
            runChatTest={runChatTest}
            chatOut={chatOut}
          />
        )}

        {tab === "docs" && (
          <DocsTab totalTraceCostFromRows={totalTraceCostFromRows} />
        )}

        {error && <div className="panel error">{error}</div>}
      </div>
    </div>
  );
}
