import React, { useMemo, useState } from "react";
import { Metric } from "../Metric";
import { ProgressStat } from "../ProgressStat";
import { fmt, formatTokenCount, usd } from "../../lib/ui";
import type {
  ExposedModel,
  TraceRangePreset,
  TraceStats,
  TraceUsageStats,
} from "../../types";

type Props = {
  stats: { total: number; enabled: number; blocked: number };
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
  traceStats: TraceStats;
  traceUsageStats: TraceUsageStats;
  storageInfo: any;
  models: ExposedModel[];
  range: TraceRangePreset;
  setRange: (range: TraceRangePreset) => void;
};

export function OverviewTab({
  stats,
  providerQuotaStats,
  traceStats,
  traceUsageStats,
  storageInfo,
  models,
  range,
  setRange,
}: Props) {
  const [providerTab, setProviderTab] = useState<"all" | "openai" | "mistral">(
    "all",
  );

  const filteredModels = useMemo(() => {
    if (providerTab === "all") return models;
    return models.filter(
      (model) => (model.metadata?.provider ?? "openai") === providerTab,
    );
  }, [models, providerTab]);

  return (
    <>
      <section className="panel">
        <div className="inline wrap row-between">
          <div>
            <h2>Overview range</h2>
            <p className="muted">
              Trace-window analytics update with the selected time range.
            </p>
          </div>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as TraceRangePreset)}
          >
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
            <option value="30d">Last 30d</option>
            <option value="all">All time</option>
          </select>
        </div>
      </section>

      <section className="grid cards3">
        <Metric title="Accounts" value={`${stats.total}`} />
        <Metric title="Enabled" value={`${stats.enabled}`} />
        <Metric title="Blocked" value={`${stats.blocked}`} />
      </section>

      <section className="grid cards4">
        <Metric
          title="Requests (selected range)"
          value={`${traceStats.totals.requests}`}
        />
        <Metric
          title="Tokens (selected range)"
          value={formatTokenCount(traceStats.totals.tokensTotal)}
        />
        <Metric
          title="Estimated cost (selected range)"
          value={usd(traceStats.totals.costUsd)}
        />
        <Metric
          title="Accounts with traffic"
          value={`${traceUsageStats.byAccount.length}`}
        />
      </section>

      <section className="panel">
        <div className="inline wrap row-between">
          <div>
            <h2>Live provider quota snapshots</h2>
            <p className="muted">
              These reflect provider-reported quota windows, not the selected
              trace range.
            </p>
          </div>
          <span className="muted">
            Last refresh {fmt(providerQuotaStats.freshestAt)}
          </span>
        </div>
        <div className="grid cards2">
          <div>
            <ProgressStat
              label="5h average"
              value={providerQuotaStats.primaryAvg}
              count={providerQuotaStats.primaryCount}
            />
            <ProgressStat
              label="Weekly average"
              value={providerQuotaStats.secondaryAvg}
              count={providerQuotaStats.secondaryCount}
            />
          </div>
          <ul className="clean-list">
            <li>
              Account-scoped snapshots: {providerQuotaStats.accountScoped}
            </li>
            <li>Needs account ID repair: {providerQuotaStats.degraded}</li>
            <li>
              Provider snapshot unsupported: {providerQuotaStats.unsupported}
            </li>
          </ul>
        </div>
      </section>

      <section className="grid cards2">
        <section className="panel">
          <h2>Persistence</h2>
          {storageInfo && (
            <ul className="clean-list">
              <li className="mono">accounts: {storageInfo.accountsPath}</li>
              <li className="mono">oauth: {storageInfo.oauthStatePath}</li>
              <li className="mono">trace: {storageInfo.tracePath}</li>
              <li className="mono">
                trace stats: {storageInfo.traceStatsHistoryPath}
              </li>
              <li>
                {storageInfo.persistenceLikelyEnabled
                  ? "Persistence mount detected"
                  : "Persistence not guaranteed"}
              </li>
            </ul>
          )}
        </section>
        <section className="panel">
          <div className="inline wrap row-between">
            <h2>Models exposed</h2>
            <div className="inline wrap">
              <button
                className={providerTab === "all" ? "tab active" : "tab"}
                onClick={() => setProviderTab("all")}
              >
                All
              </button>
              <button
                className={providerTab === "openai" ? "tab active" : "tab"}
                onClick={() => setProviderTab("openai")}
              >
                OpenAI
              </button>
              <button
                className={providerTab === "mistral" ? "tab active" : "tab"}
                onClick={() => setProviderTab("mistral")}
              >
                Mistral
              </button>
            </div>
          </div>
          <div className="chips">
            {filteredModels.map((model) => (
              <span key={model.id} className="chip mono">
                {model.id}
              </span>
            ))}
          </div>
        </section>
      </section>
    </>
  );
}
