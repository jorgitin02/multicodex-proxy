import React, { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Metric } from "../Metric";
import {
  CHART_COLORS,
  DEFAULT_ACCOUNTS_SECTION_ORDER,
  fmt,
  formatTokenCount,
  maskEmail,
  maskId,
  usd,
} from "../../lib/ui";
import type {
  Account,
  AccountsSectionId,
  TraceRangePreset,
  TraceStats,
  TraceUsageStats,
} from "../../types";

type Props = {
  range: TraceRangePreset;
  setRange: (range: TraceRangePreset) => void;
  traceStats: TraceStats;
  traceUsageStats: TraceUsageStats;
  providerQuotaStats: {
    primaryAvg: number;
    secondaryAvg: number;
    primaryCount: number;
    secondaryCount: number;
    accountScoped: number;
    degraded: number;
    unsupported: number;
    freshestAt: number;
  };
  accountsPreferences: {
    sectionOrder: AccountsSectionId[];
    hiddenSections: AccountsSectionId[];
  };
  moveAccountsSection: (sectionId: AccountsSectionId, direction: -1 | 1) => void;
  toggleAccountsSectionHidden: (sectionId: AccountsSectionId) => void;
  resetAccountsLayout: () => void;
  accounts: Account[];
  sanitized: boolean;
  patch: (id: string, body: any) => Promise<void>;
  del: (id: string) => Promise<void>;
  unblock: (id: string) => Promise<void>;
  refreshUsage: (id: string) => Promise<void>;
  createAccount: (body: any) => Promise<void>;
  startOAuth: (email: string, accountId?: string) => Promise<any>;
  completeOAuth: (flowId: string, input: string) => Promise<any>;
  oauthRedirectUri: string;
};

type EditAccountState = {
  id: string;
  provider: "openai" | "mistral";
  email: string;
  accessToken: string;
  refreshToken: string;
  chatgptAccountId: string;
  priority: string;
  enabled: boolean;
};

type OAuthDialogState = {
  flowId: string;
  email: string;
  authorizeUrl: string;
  expectedRedirectUri: string;
  callbackInput: string;
  isSubmitting: boolean;
  mode: "create" | "reauth";
  accountId?: string;
  pendingPriority?: number;
  pendingEnabled?: boolean;
};

function sectionLabel(sectionId: AccountsSectionId) {
  switch (sectionId) {
    case "requestsByAccount":
      return "Requests by account";
    case "tokensByAccount":
      return "Tokens by account";
    case "costByAccount":
      return "Cost by account";
    case "providerQuota":
      return "Live provider quota";
    default:
      return sectionId;
  }
}

export function AccountsTab(props: Props) {
  const {
    range,
    setRange,
    traceStats,
    traceUsageStats,
    providerQuotaStats,
    accountsPreferences,
    moveAccountsSection,
    toggleAccountsSectionHidden,
    resetAccountsLayout,
    accounts,
    sanitized,
    patch,
    del,
    unblock,
    refreshUsage,
    createAccount,
    startOAuth,
    completeOAuth,
    oauthRedirectUri,
  } = props;
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [provider, setProvider] = useState<"openai" | "mistral">("openai");
  const [manualEmail, setManualEmail] = useState("");
  const [manualAccessToken, setManualAccessToken] = useState("");
  const [manualRefreshToken, setManualRefreshToken] = useState("");
  const [manualPriority, setManualPriority] = useState("0");
  const [manualEnabled, setManualEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingAccount, setEditingAccount] = useState<EditAccountState | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [oauthBusyId, setOauthBusyId] = useState<string | null>(null);
  const [oauthDialog, setOauthDialog] = useState<OAuthDialogState | null>(null);
  const [layoutEditMode, setLayoutEditMode] = useState(false);

  useEffect(() => {
    if (!oauthDialog) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if ((data as { type?: string }).type !== "multivibe-oauth-callback") return;
      const callbackUrl = (data as { callbackUrl?: string }).callbackUrl;
      if (typeof callbackUrl !== "string" || !callbackUrl.trim()) return;

      try {
        const received = new URL(callbackUrl);
        const expected = new URL(oauthDialog.expectedRedirectUri);
        if (received.origin !== expected.origin || received.pathname !== expected.pathname) {
          return;
        }
      } catch {
        return;
      }

      setOauthDialog((current) =>
        current ? { ...current, callbackInput: callbackUrl.trim() } : current,
      );
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [oauthDialog]);

  const accountChartData = useMemo(
    () =>
      traceUsageStats.byAccount.slice(0, 8).map((entry) => ({
        id: entry.accountId,
        label: sanitized
          ? maskEmail(entry.account.email) || maskId(entry.accountId)
          : entry.account.email ?? entry.accountId,
        requests: entry.requests,
        tokens: entry.tokens.total,
        costUsd: entry.costUsd,
      })),
    [sanitized, traceUsageStats.byAccount],
  );

  const layoutChanged =
    accountsPreferences.sectionOrder.some((sectionId, index) => sectionId !== DEFAULT_ACCOUNTS_SECTION_ORDER[index]) ||
    accountsPreferences.hiddenSections.length > 0;

  const closeModal = () => {
    setShowAddAccount(false);
    setProvider("openai");
    setManualEmail("");
    setManualAccessToken("");
    setManualRefreshToken("");
    setManualPriority("0");
    setManualEnabled(true);
    setIsSubmitting(false);
  };

  const closeEditModal = () => {
    setEditingAccount(null);
    setIsSavingEdit(false);
  };

  const closeOauthDialog = () => {
    setOauthDialog(null);
  };

  const submitManualAccount = async () => {
    if (provider === "openai") {
      if (!manualEmail.trim()) return;
      setIsSubmitting(true);
      try {
        const result = await startOAuth(manualEmail.trim());
        const authorizeUrl = result?.authorizeUrl as string | undefined;
        const flowId = result?.flowId as string | undefined;
        const expectedRedirectUri =
          (result?.expectedRedirectUri as string | undefined) || oauthRedirectUri;
        if (!authorizeUrl || !flowId) {
          throw new Error("Missing OAuth flow details from start response");
        }
        setOauthDialog({
          flowId,
          email: manualEmail.trim(),
          authorizeUrl,
          expectedRedirectUri,
          callbackInput: "",
          isSubmitting: false,
          mode: "create",
          pendingPriority: Number(manualPriority) || 0,
          pendingEnabled: manualEnabled,
        });
        window.open(authorizeUrl, "_blank", "noopener,noreferrer");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!manualAccessToken.trim()) return;
    setIsSubmitting(true);
    try {
      await createAccount({
        provider,
        email: manualEmail.trim() || undefined,
        accessToken: manualAccessToken.trim(),
        refreshToken: manualRefreshToken.trim() || undefined,
        priority: Number(manualPriority) || 0,
        enabled: manualEnabled,
      });
      closeModal();
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (account: Account) => {
    setEditingAccount({
      id: account.id,
      provider: account.provider === "mistral" ? "mistral" : "openai",
      email: account.email ?? "",
      accessToken: account.accessToken ?? "",
      refreshToken: account.refreshToken ?? "",
      chatgptAccountId: account.chatgptAccountId ?? "",
      priority: String(account.priority ?? 0),
      enabled: account.enabled,
    });
  };

  const startOpenAiReauth = async () => {
    if (!editingAccount) return;
    if (editingAccount.provider !== "openai") return;
    if (!editingAccount.email.trim()) return;
    setIsSavingEdit(true);
    try {
      const result = await startOAuth(editingAccount.email.trim(), editingAccount.id);
      const authorizeUrl = result?.authorizeUrl as string | undefined;
      const flowId = result?.flowId as string | undefined;
      const expectedRedirectUri =
        (result?.expectedRedirectUri as string | undefined) || oauthRedirectUri;
      if (!authorizeUrl || !flowId) {
        throw new Error("Missing OAuth flow details from start response");
      }
      closeEditModal();
      setOauthDialog({
        flowId,
        email: editingAccount.email.trim(),
        authorizeUrl,
        expectedRedirectUri,
        callbackInput: "",
        isSubmitting: false,
        mode: "reauth",
        accountId: editingAccount.id,
      });
      window.open(authorizeUrl, "_blank", "noopener,noreferrer");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const saveOpenAiMetadata = async () => {
    if (!editingAccount) return;
    if (editingAccount.provider !== "openai") return;
    setIsSavingEdit(true);
    try {
      await patch(editingAccount.id, {
        email: editingAccount.email.trim() || undefined,
        chatgptAccountId: editingAccount.chatgptAccountId.trim() || undefined,
        priority: Number(editingAccount.priority) || 0,
        enabled: editingAccount.enabled,
      });
      closeEditModal();
    } finally {
      setIsSavingEdit(false);
    }
  };

  const saveEditedAccount = async () => {
    if (!editingAccount) return;
    if (editingAccount.provider === "openai") return;
    if (!editingAccount.accessToken.trim()) return;
    setIsSavingEdit(true);
    try {
      await patch(editingAccount.id, {
        email: editingAccount.email.trim() || undefined,
        accessToken: editingAccount.accessToken.trim(),
        refreshToken: editingAccount.refreshToken.trim() || undefined,
        chatgptAccountId: editingAccount.chatgptAccountId.trim() || undefined,
        priority: Number(editingAccount.priority) || 0,
        enabled: editingAccount.enabled,
      });
      closeEditModal();
    } finally {
      setIsSavingEdit(false);
    }
  };

  const submitOauthCallback = async () => {
    if (!oauthDialog?.callbackInput.trim()) return;
    setIsSavingEdit(true);
    try {
      setOauthDialog((current) =>
        current ? { ...current, isSubmitting: true } : current,
      );
      const result = await completeOAuth(oauthDialog.flowId, oauthDialog.callbackInput.trim());
      const accountId = String(result?.account?.id ?? oauthDialog.accountId ?? "").trim();
      if (
        oauthDialog.mode === "create" &&
        accountId &&
        (oauthDialog.pendingPriority !== 0 || oauthDialog.pendingEnabled === false)
      ) {
        await patch(accountId, {
          priority: oauthDialog.pendingPriority ?? 0,
          enabled: oauthDialog.pendingEnabled ?? true,
        });
      }
      closeOauthDialog();
      closeModal();
    } finally {
      setIsSavingEdit(false);
      setOauthDialog((current) =>
        current ? { ...current, isSubmitting: false } : current,
      );
    }
  };

  const reauthAccount = async (account: Account) => {
    if ((account.provider ?? "openai") !== "openai") return;
    if (!account.email?.trim()) {
      window.alert("This OpenAI account has no email, so reauth cannot be started.");
      return;
    }
    setOauthBusyId(account.id);
    try {
      const result = await startOAuth(account.email.trim(), account.id);
      const authorizeUrl = result?.authorizeUrl as string | undefined;
      const flowId = result?.flowId as string | undefined;
      const expectedRedirectUri =
        (result?.expectedRedirectUri as string | undefined) || oauthRedirectUri;
      if (!authorizeUrl || !flowId) {
        throw new Error("Missing OAuth flow details from OAuth start response");
      }
      setOauthDialog({
        flowId,
        email: account.email.trim(),
        authorizeUrl,
        expectedRedirectUri,
        callbackInput: "",
        isSubmitting: false,
        mode: "reauth",
        accountId: account.id,
      });
      window.open(authorizeUrl, "_blank", "noopener,noreferrer");
    } finally {
      setOauthBusyId(null);
    }
  };

  const providerFavicon = (provider?: string) =>
    provider === "mistral" ? "https://mistral.ai/favicon.ico" : "https://openai.com/favicon.ico";

  const providerLabel = (provider?: string) => (provider === "mistral" ? "Mistral" : "OpenAI");

  const quotaStatus = (account: Account) => {
    if (account.usage?.scope === "unscoped") return account.usage.degradedReason ?? "Needs ChatGPT account ID";
    if (account.usage?.scope === "unsupported") return account.usage.degradedReason ?? "Provider quota unsupported";
    if (account.usage?.scope === "account") return "Account-scoped snapshot";
    return "No provider snapshot yet";
  };

  const sections: Record<AccountsSectionId, { title: string; render: () => React.ReactNode }> = {
    requestsByAccount: {
      title: "Requests by account",
      render: () => (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={accountChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d6dde4" />
              <XAxis dataKey="label" interval={0} angle={-15} textAnchor="end" height={56} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="requests" name="requests" fill={CHART_COLORS[0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ),
    },
    tokensByAccount: {
      title: "Tokens by account",
      render: () => (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={accountChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d6dde4" />
              <XAxis dataKey="label" interval={0} angle={-15} textAnchor="end" height={56} />
              <YAxis tickFormatter={(value: number) => formatTokenCount(Number(value))} />
              <Tooltip formatter={(value: number) => formatTokenCount(Number(value))} />
              <Bar dataKey="tokens" name="tokens" fill={CHART_COLORS[1]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ),
    },
    costByAccount: {
      title: "Cost by account",
      render: () => (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={accountChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d6dde4" />
              <XAxis dataKey="label" interval={0} angle={-15} textAnchor="end" height={56} />
              <YAxis />
              <Tooltip formatter={(value: number) => usd(Number(value) || 0)} />
              <Bar dataKey="costUsd" name="cost usd" fill={CHART_COLORS[2]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ),
    },
    providerQuota: {
      title: "Live provider quota snapshots",
      render: () => (
        <>
          <p className="muted">Provider quota windows are live snapshots and do not follow the selected trace range.</p>
          <ul className="clean-list">
            <li>Last refresh: {fmt(providerQuotaStats.freshestAt)}</li>
            <li>Account-scoped snapshots: {providerQuotaStats.accountScoped}</li>
            <li>Needs account ID repair: {providerQuotaStats.degraded}</li>
            <li>Provider unsupported: {providerQuotaStats.unsupported}</li>
          </ul>
        </>
      ),
    },
  };

  const hiddenSections = accountsPreferences.hiddenSections;

  return (
    <>
      <section className="panel">
        <div className="inline wrap row-between">
          <div>
            <h2>Accounts range</h2>
            <p className="muted">Charts below use retained trace history for the selected window.</p>
          </div>
          <select value={range} onChange={(e) => setRange(e.target.value as TraceRangePreset)}>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
            <option value="30d">Last 30d</option>
            <option value="all">All time</option>
          </select>
        </div>
      </section>

      <section className="grid cards4">
        <Metric title="Requests (selected range)" value={`${traceStats.totals.requests}`} />
        <Metric title="Tokens (selected range)" value={formatTokenCount(traceStats.totals.tokensTotal)} />
        <Metric title="Estimated cost (selected range)" value={usd(traceStats.totals.costUsd)} />
        <Metric title="Accounts with traffic" value={`${traceUsageStats.byAccount.length}`} />
      </section>

      <section className="accounts-layout-actions">
        <p className="muted">Accounts analytics layout is saved globally.</p>
        <div className="inline wrap">
          <button className="btn ghost" onClick={() => setLayoutEditMode((current) => !current)}>
            {layoutEditMode ? "Done editing" : "Edit analytics"}
          </button>
          <button className="btn secondary" onClick={resetAccountsLayout} disabled={!layoutChanged}>
            Reset analytics
          </button>
        </div>
      </section>

      {!!hiddenSections.length && (
        <section className="panel">
          <div className="inline wrap">
            <span className="muted">Hidden sections:</span>
            {hiddenSections.map((sectionId) => (
              <button key={sectionId} className="btn ghost small" onClick={() => toggleAccountsSectionHidden(sectionId)}>
                Show {sectionLabel(sectionId)}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="grid tracing-layout">
        {accountsPreferences.sectionOrder
          .filter((sectionId) => !hiddenSections.includes(sectionId))
          .map((sectionId, index) => (
            <section key={sectionId} className="panel tracing-card">
              <div className="tracing-card-head">
                <h2>{sections[sectionId].title}</h2>
                <div className="inline wrap tracing-card-toolbar">
                  <button className="btn ghost small" onClick={() => toggleAccountsSectionHidden(sectionId)}>
                    Hide
                  </button>
                  {layoutEditMode && (
                    <>
                      <button className="btn ghost small" onClick={() => moveAccountsSection(sectionId, -1)} disabled={index === 0}>
                        Earlier
                      </button>
                      <button
                        className="btn ghost small"
                        onClick={() => moveAccountsSection(sectionId, 1)}
                        disabled={index === accountsPreferences.sectionOrder.filter((entry) => !hiddenSections.includes(entry)).length - 1}
                      >
                        Later
                      </button>
                    </>
                  )}
                </div>
              </div>
              {sections[sectionId].render()}
            </section>
          ))}
      </section>

      <section className="panel">
        <div className="inline wrap row-between">
          <h2>Accounts</h2>
          <button className="btn" onClick={() => setShowAddAccount(true)}>
            Add account
          </button>
        </div>
        {providerQuotaStats.degraded > 0 && (
          <p className="warning-text">
            {providerQuotaStats.degraded} account{providerQuotaStats.degraded === 1 ? "" : "s"} need a `ChatGPT-Account-Id`
            refresh before weekly provider quota can be trusted.
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Email</th>
                <th>ID</th>
                <th>5h</th>
                <th>Week</th>
                <th>Quota status</th>
                <th>Blocked</th>
                <th>Error</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <span className="provider-badge">
                      <img
                        className="provider-icon"
                        src={providerFavicon(account.provider)}
                        alt={`${providerLabel(account.provider)} icon`}
                        loading="lazy"
                      />
                      {providerLabel(account.provider)}
                    </span>
                  </td>
                  <td>{sanitized ? maskEmail(account.email) : account.email ?? "-"}</td>
                  <td className="mono">{sanitized ? maskId(account.id) : account.id}</td>
                  <td>
                    {typeof account.usage?.primary?.usedPercent === "number" ? `${Math.round(account.usage.primary.usedPercent)}%` : "?"}
                    <small>{fmt(account.usage?.primary?.resetAt)}</small>
                  </td>
                  <td>
                    {typeof account.usage?.secondary?.usedPercent === "number" ? `${Math.round(account.usage.secondary.usedPercent)}%` : "?"}
                    <small>{fmt(account.usage?.secondary?.resetAt)}</small>
                  </td>
                  <td>
                    <span className={account.usage?.scope === "account" ? "muted" : "warning-text"}>
                      {quotaStatus(account)}
                    </span>
                  </td>
                  <td>{fmt(account.state?.blockedUntil)}</td>
                  <td className="mono">{account.state?.lastError?.slice(0, 80) ?? "-"}</td>
                  <td className="inline wrap">
                    <button className="btn ghost" onClick={() => openEditModal(account)}>Change key</button>
                    {account.provider !== "mistral" && (
                      <button
                        className="btn ghost"
                        disabled={oauthBusyId === account.id}
                        onClick={() => void reauthAccount(account)}
                      >
                        {oauthBusyId === account.id ? "Opening..." : "Reauth"}
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => void patch(account.id, { enabled: !account.enabled })}>
                      {account.enabled ? "Disable" : "Enable"}
                    </button>
                    <button className="btn ghost" onClick={() => void unblock(account.id)}>Unblock</button>
                    <button className="btn ghost" onClick={() => void refreshUsage(account.id)}>Refresh</button>
                    <button className="btn danger" onClick={() => void del(account.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showAddAccount && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            <div className="inline wrap row-between">
              <h2>Add account</h2>
              <button className="btn ghost" onClick={closeModal}>
                Close
              </button>
            </div>
            <div className="grid modal-grid">
              <label>
                Provider
                <select value={provider} onChange={(e) => setProvider(e.target.value as "openai" | "mistral")}>
                  <option value="openai">OpenAI</option>
                  <option value="mistral">Mistral</option>
                </select>
              </label>
              <label>
                Email (optional)
                <input value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="account@email.com" />
              </label>
              {provider === "mistral" ? (
                <>
                  <label>
                    Access token
                    <input value={manualAccessToken} onChange={(e) => setManualAccessToken(e.target.value)} placeholder="Required" />
                  </label>
                  <label>
                    Refresh token (optional)
                    <input value={manualRefreshToken} onChange={(e) => setManualRefreshToken(e.target.value)} placeholder="Optional" />
                  </label>
                </>
              ) : (
                <div className="muted">
                  OpenAI onboarding uses OAuth. Start the flow, complete the browser callback,
                  then paste the full callback URL here instead of entering access or refresh
                  tokens manually.
                </div>
              )}
              <label>
                Priority
                <input value={manualPriority} onChange={(e) => setManualPriority(e.target.value)} placeholder="0" />
              </label>
              <label className="inline">
                <input type="checkbox" checked={manualEnabled} onChange={(e) => setManualEnabled(e.target.checked)} />
                Enabled
              </label>
            </div>
            <div className="inline wrap">
              <button
                className="btn"
                disabled={
                  isSubmitting ||
                  (provider === "openai" ? !manualEmail.trim() : !manualAccessToken.trim())
                }
                onClick={() => void submitManualAccount()}
              >
                {isSubmitting
                  ? provider === "openai"
                    ? "Starting OAuth..."
                    : "Creating..."
                  : provider === "openai"
                    ? "Start OAuth"
                    : "Create account"}
              </button>
              <button className="btn ghost" onClick={closeModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {editingAccount && (
        <div className="modal-backdrop" onClick={closeEditModal}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            <div className="inline wrap row-between">
              <h2>Update account</h2>
              <button className="btn ghost" onClick={closeEditModal}>
                Close
              </button>
            </div>
            <div className="grid modal-grid">
              <label>
                Email (optional)
                <input
                  value={editingAccount.email}
                  onChange={(e) =>
                    setEditingAccount((current) =>
                      current ? { ...current, email: e.target.value } : current,
                    )
                  }
                  placeholder="account@email.com"
                />
              </label>
              {editingAccount.provider === "mistral" ? (
                <>
                  <label>
                    Access token
                    <input
                      value={editingAccount.accessToken}
                      onChange={(e) =>
                        setEditingAccount((current) =>
                          current ? { ...current, accessToken: e.target.value } : current,
                        )
                      }
                      placeholder="Required"
                    />
                  </label>
                  <label>
                    Refresh token (optional)
                    <input
                      value={editingAccount.refreshToken}
                      onChange={(e) =>
                        setEditingAccount((current) =>
                          current ? { ...current, refreshToken: e.target.value } : current,
                        )
                      }
                      placeholder="Optional"
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="muted">
                    OpenAI reauth uses OAuth. Use “Save metadata” to repair account-scoped usage fields
                    without rotating tokens, or start reauth if the login session itself needs repair.
                  </div>
                  <label>
                    ChatGPT account ID (optional)
                    <input
                      value={editingAccount.chatgptAccountId}
                      onChange={(e) =>
                        setEditingAccount((current) =>
                          current ? { ...current, chatgptAccountId: e.target.value } : current,
                        )
                      }
                      placeholder="Required for account-scoped OpenAI quota refresh"
                    />
                  </label>
                </>
              )}
              <label>
                Priority
                <input
                  value={editingAccount.priority}
                  onChange={(e) =>
                    setEditingAccount((current) =>
                      current ? { ...current, priority: e.target.value } : current,
                    )
                  }
                  placeholder="0"
                />
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={editingAccount.enabled}
                  onChange={(e) =>
                    setEditingAccount((current) =>
                      current ? { ...current, enabled: e.target.checked } : current,
                    )
                  }
                />
                Enabled
              </label>
            </div>
            <div className="inline wrap">
              {editingAccount.provider === "openai" ? (
                <>
                  <button className="btn secondary" disabled={isSavingEdit} onClick={() => void saveOpenAiMetadata()}>
                    {isSavingEdit ? "Saving..." : "Save metadata"}
                  </button>
                  <button
                    className="btn"
                    disabled={isSavingEdit || !editingAccount.email.trim()}
                    onClick={() => void startOpenAiReauth()}
                  >
                    {isSavingEdit ? "Starting OAuth..." : "Start reauth"}
                  </button>
                </>
              ) : (
                <button
                  className="btn"
                  disabled={isSavingEdit || !editingAccount.accessToken.trim()}
                  onClick={() => void saveEditedAccount()}
                >
                  {isSavingEdit ? "Saving..." : "Save changes"}
                </button>
              )}
              <button className="btn ghost" onClick={closeEditModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {oauthDialog && (
        <div className="modal-backdrop" onClick={closeOauthDialog}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            <div className="inline wrap row-between">
              <h2>{oauthDialog.mode === "create" ? "Complete OpenAI OAuth" : "Complete OpenAI reauth"}</h2>
              <button className="btn ghost" onClick={closeOauthDialog}>
                Close
              </button>
            </div>
            <div className="grid modal-grid">
              <label>
                Email
                <input value={oauthDialog.email} disabled />
              </label>
              <label>
                Redirect URI
                <input value={oauthDialog.expectedRedirectUri} disabled />
              </label>
              <label>
                Callback URL
                <textarea
                  value={oauthDialog.callbackInput}
                  onChange={(e) =>
                    setOauthDialog((current) =>
                      current ? { ...current, callbackInput: e.target.value } : current,
                    )
                  }
                  placeholder="Paste the full URL after the browser reaches the callback page"
                  rows={5}
                />
              </label>
            </div>
            <div className="muted">
              Complete the OpenAI login in the opened browser tab. When the browser reaches
              the callback page, the full URL should autofill here. If it does not, copy the
              full URL and paste it here. Do not paste access or refresh tokens.
            </div>
            <div className="inline wrap">
              <button
                className="btn"
                disabled={oauthDialog.isSubmitting || !oauthDialog.callbackInput.trim()}
                onClick={() => void submitOauthCallback()}
              >
                {oauthDialog.isSubmitting ? "Saving..." : "Finish OAuth"}
              </button>
              <button className="btn ghost" onClick={closeOauthDialog}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
