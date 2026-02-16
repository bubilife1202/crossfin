import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";

const API = "https://crossfin.dev";
const REFRESH_INTERVAL = 15_000;

/* ─── Types ─── */

interface ArbitragePair {
  coin: string;
  premiumPct: number;
  direction: string;
}

interface ArbitrageRaw {
  demo: boolean;
  avgPremiumPct: number;
  preview: ArbitragePair[];
  at: string;
}

interface ArbitrageData {
  average_premium: number;
  pairs: ArbitragePair[];
}

interface RegistryStatsRaw {
  services: { total: number; crossfin: number; external: number };
}

interface RegistryStats {
  total: number;
  crossfin: number;
  external: number;
}

interface RecentCallRaw {
  serviceName: string;
  status: string;
  responseTimeMs: number | null;
  createdAt: string;
}

interface TopServiceRaw {
  serviceName: string;
  calls: number;
}

interface AnalyticsRaw {
  totalCalls: number;
  topServices: TopServiceRaw[];
  recentCalls: RecentCallRaw[];
}

interface RecentCall {
  service: string;
  status: string;
  responseTime: number;
  when: string;
}

interface TopService {
  name: string;
  calls: number;
}

interface AnalyticsOverview {
  totalCalls: number;
  topServices: TopService[];
  recentCalls: RecentCall[];
}

interface HealthData {
  status: string;
  version?: string;
}

interface FxData {
  rates: Record<string, number>;
}

interface SurvivalData {
  alive: boolean;
  state: 'ALIVE' | 'STOPPED';
  version: string;
  metrics: {
    totalCalls: number;
    callsToday: number;
    callsThisWeek: number;
    activeServices: number;
  };
  at: string;
}

/* ─── Helpers ─── */

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ─── Fetch helpers ─── */

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/* ─── App ─── */

export default function App() {
  const [arb, setArb] = useState<ArbitrageData | null>(null);
  const [stats, setStats] = useState<RegistryStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [survival, setSurvival] = useState<SurvivalData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [connected, setConnected] = useState(true);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      fetchJson<ArbitrageRaw>(`${API}/api/arbitrage/demo`),
      fetchJson<RegistryStatsRaw>(`${API}/api/registry/stats`),
      fetchJson<AnalyticsRaw>(`${API}/api/analytics/overview`),
      fetchJson<HealthData>(`${API}/api/health`),
      fetchJson<FxData>("https://open.er-api.com/v6/latest/USD"),
      fetchJson<SurvivalData>(`${API}/api/survival/status`),
    ]);

    const vals = results.map((r) =>
      r.status === "fulfilled" ? r.value : null,
    );

    const [arbRaw, statsRaw, analyticsRaw, healthVal, fxVal, survivalVal] = vals as [
      ArbitrageRaw | null,
      RegistryStatsRaw | null,
      AnalyticsRaw | null,
      HealthData | null,
      FxData | null,
      SurvivalData | null,
    ];

    const arbVal: ArbitrageData | null = arbRaw
      ? {
          average_premium: arbRaw.avgPremiumPct ?? 0,
          pairs: (arbRaw.preview ?? []).map((p) => ({
            coin: p.coin,
            premiumPct: p.premiumPct,
            direction: p.direction ?? (p.premiumPct >= 0 ? "Korea premium" : "Korea discount"),
          })),
        }
      : null;

    const statsVal: RegistryStats | null = statsRaw?.services
      ? statsRaw.services
      : null;

    const analyticsVal: AnalyticsOverview | null = analyticsRaw
      ? {
          totalCalls: analyticsRaw.totalCalls ?? 0,
          topServices: (analyticsRaw.topServices ?? []).map((s) => ({
            name: s.serviceName ?? "Unknown",
            calls: Number(s.calls ?? 0),
          })),
          recentCalls: (analyticsRaw.recentCalls ?? []).map((c) => ({
            service: c.serviceName ?? "Unknown",
            status: c.status ?? "unknown",
            responseTime: Number(c.responseTimeMs ?? 0),
            when: c.createdAt ? timeAgo(c.createdAt) : "—",
          })),
        }
      : null;

    setArb(arbVal);
    setStats(statsVal);
    setAnalytics(analyticsVal);
    setHealth(healthVal);
    if (fxVal?.rates?.KRW) setFxRate(fxVal.rates.KRW);
    setSurvival(survivalVal);

    const anyOk = arbVal ?? statsVal ?? analyticsVal ?? healthVal;
    setConnected(!!anyOk);
    setLastUpdate(new Date());
    progressRef.current = 0;
    setProgress(0);
  }, []);

  // initial + interval
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, REFRESH_INTERVAL);
    return () => window.clearInterval(id);
  }, [refresh]);

  // progress bar ticks
  useEffect(() => {
    const step = 100 / (REFRESH_INTERVAL / 60);
    const id = window.setInterval(() => {
      progressRef.current = Math.min(progressRef.current + step, 100);
      setProgress(progressRef.current);
    }, 60);
    return () => window.clearInterval(id);
  }, []);

  const avgPremium = arb?.average_premium ?? 0;
  const totalServices = stats?.total ?? 0;
  const totalCalls = analytics?.totalCalls ?? 0;
  const topServices = analytics?.topServices ?? [];
  const recentCalls = analytics?.recentCalls ?? [];
  const pairs = arb?.pairs ?? [];

  const maxServiceCalls = topServices.length
    ? Math.max(...topServices.map((s) => s.calls))
    : 1;

  return (
    <div className="dashboard">
      {/* Progress bar */}
      <div className="refreshBar">
        <div className="refreshBarFill" style={{ width: `${progress}%` }} />
      </div>

      {/* Header */}
      <header className="header">
        <div className="headerInner">
          <div className="headerLeft">
            <span className="logo">
              <span className="logoMark">⬡</span> CrossFin Live
            </span>
            <span className="subtitle">Real-time Gateway Monitor</span>
          </div>
          <div className="headerRight">
            <span className={`connStatus ${connected ? "ok" : "err"}`}>
              <span className="connDot" />
              {connected ? "Connected" : "Disconnected"}
            </span>
            <span className="lastUpdate">
              {lastUpdate.toLocaleTimeString()}
            </span>
          </div>
        </div>
      </header>

      <main className="main">
        {/* Row 1: Metric cards */}
        <section className="metricsRow">
          <MetricCard
            label="Avg Kimchi Premium"
            value={`${avgPremium >= 0 ? "+" : ""}${avgPremium.toFixed(2)}%`}
            tone={avgPremium >= 0 ? "positive" : "negative"}
            sub="KR↔Global spread"
          />
          <MetricCard
            label="Total Services"
            value={String(totalServices)}
            tone="neutral"
            sub="registered in gateway"
          />
          <MetricCard
            label="Gateway Calls"
            value={totalCalls.toLocaleString()}
            tone="neutral"
            sub="total API requests"
          />
          <MetricCard
            label="USD/KRW Rate"
            value={fxRate ? `₩${fxRate.toLocaleString()}` : "—"}
            tone="neutral"
            sub="live exchange rate"
          />
        </section>

        {/* Row 2: Kimchi Premium Table */}
        <section className="panel">
          <div className="panelHeader">
            <h2 className="panelTitle">Live Kimchi Premium</h2>
            <span className="panelBadge">
              <span className="liveDot" />
              Auto-refresh 15s
            </span>
          </div>
          <div className="tableWrap">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Premium %</th>
                  <th>Direction</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pairs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="emptyRow">
                      Loading pairs…
                    </td>
                  </tr>
                )}
                {pairs.map((p) => (
                  <tr key={p.coin} className="fadeIn">
                    <td className="coinCell">{p.coin}</td>
                    <td
                      className={`pctCell ${p.premiumPct >= 0 ? "positive" : "negative"}`}
                    >
                      {p.premiumPct >= 0 ? "+" : ""}
                      {p.premiumPct.toFixed(3)}%
                    </td>
                    <td className="dirCell">{p.direction}</td>
                    <td>
                      <span className="statusPill active">
                        <span className="statusDotSmall" />
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Row 2.5: Agent Survival */}
        {survival && (
          <section className={`panel survivalSection ${survival.state === "ALIVE" ? "alive" : "stopped"}`}>
            <div className="survivalHeader">
              <h2 className="panelTitle">Agent Survival</h2>
              <span className={`survivalBadge ${survival.state === "ALIVE" ? "alive" : "stopped"}`}>
                <span className="survivalDot" />
                {survival.state}
              </span>
            </div>
            <div className="survivalMetrics">
              <div className="survivalMiniCard">
                <span className="metricLabel">Calls Today</span>
                <span className="metricValue neutral">{survival.metrics.callsToday.toLocaleString()}</span>
              </div>
              <div className="survivalMiniCard">
                <span className="metricLabel">Calls This Week</span>
                <span className="metricValue neutral">{survival.metrics.callsThisWeek.toLocaleString()}</span>
              </div>
              <div className="survivalMiniCard">
                <span className="metricLabel">Active Services</span>
                <span className="metricValue neutral">{survival.metrics.activeServices.toLocaleString()}</span>
              </div>
            </div>
            <div className="survivalFeed">
              <div className="survivalFeedHeader">
                <span>Service</span>
                <span>Status</span>
                <span>Time</span>
                <span>When</span>
              </div>
              {recentCalls.length === 0 && (
                <p className="emptyText">No recent events</p>
              )}
              {recentCalls.slice(0, 8).map((evt, index) => (
                <div key={`${evt.service}-${index}`} className="survivalEvent fadeIn">
                  <span className="survivalEventName">{evt.service}</span>
                  <span className="survivalEventStatus">
                    <span className={`statusDotSmall ${evt.status === "success" ? "green" : "red"}`} />
                    {evt.status}
                  </span>
                  <span className={`recentRt ${rtClass(evt.responseTime)}`}>
                    {evt.responseTime}ms
                  </span>
                  <span className="recentWhen">{evt.when}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Row 3: Two columns */}
        <section className="twoCol">
          {/* Left: Top Services bar chart */}
          <div className="panel">
            <div className="panelHeader">
              <h2 className="panelTitle">Top Services</h2>
            </div>
            <div className="barChart">
              {topServices.length === 0 && (
                <p className="emptyText">No data yet</p>
              )}
              {topServices.map((s) => (
                <div key={s.name} className="barRow">
                  <div className="barInfo">
                    <span className="barName">{s.name}</span>
                    <span className="barCount">
                      {s.calls.toLocaleString()}
                    </span>
                  </div>
                  <div className="barTrack">
                    <div
                      className="barFill"
                      style={{
                        width: `${(s.calls / maxServiceCalls) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Recent API Calls */}
          <div className="panel">
            <div className="panelHeader">
              <h2 className="panelTitle">Recent API Calls</h2>
            </div>
            <div className="recentList">
              <div className="recentHeader">
                <span>Service</span>
                <span>Status</span>
                <span>Time</span>
                <span>When</span>
              </div>
              {recentCalls.length === 0 && (
                <p className="emptyText">No calls recorded</p>
              )}
              {recentCalls.map((c, i) => (
                <div key={`${c.service}-${i}`} className="recentRow fadeIn">
                  <span className="recentService">{c.service}</span>
                  <span className="recentStatus">
                    <span
                      className={`statusDotSmall ${c.status === "success" ? "green" : "red"}`}
                    />
                    {c.status}
                  </span>
                  <span className={`recentRt ${rtClass(c.responseTime)}`}>
                    {c.responseTime}ms
                  </span>
                  <span className="recentWhen">{c.when}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Row 4: System Health */}
        <section className="healthRow">
          <div className="healthCard">
            <span
              className={`healthDot ${health?.status === "ok" ? "green" : "red"}`}
            />
            <div className="healthInfo">
              <span className="healthLabel">System Health</span>
              <span className="healthValue">
                {health?.status === "ok" ? "Operational" : "Degraded"}
              </span>
            </div>
          </div>
          <div className="healthCard">
            <span className="healthIcon">⚡</span>
            <div className="healthInfo">
              <span className="healthLabel">API Version</span>
              <span className="healthValue">{health?.version ?? "—"}</span>
            </div>
          </div>
          <div className="healthCard">
            <span className="healthIcon">◈</span>
            <div className="healthInfo">
              <span className="healthLabel">Gateway</span>
              <span className="healthValue">crossfin.dev</span>
            </div>
          </div>
          <div className="healthCard">
            <span className="healthIcon">⏱</span>
            <div className="healthInfo">
              <span className="healthLabel">Uptime</span>
              <span className="healthValue">
                {health?.status === "ok" ? "Online" : "Checking…"}
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="footerInner">
          <span className="footerBrand">Powered by CrossFin × x402</span>
          <div className="footerLinks">
            <a
              href="https://crossfin.dev"
              target="_blank"
              rel="noopener noreferrer"
            >
              crossfin.dev
            </a>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a
              href="https://basescan.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              BaseScan
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Sub-components ─── */

function MetricCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative" | "neutral";
  sub: string;
}) {
  return (
    <div className={`metricCard ${tone}`}>
      <span className="metricLabel">{label}</span>
      <span className={`metricValue ${tone}`}>{value}</span>
      <span className="metricSub">{sub}</span>
    </div>
  );
}

function rtClass(ms: number): string {
  if (ms < 200) return "fast";
  if (ms < 500) return "medium";
  return "slow";
}
