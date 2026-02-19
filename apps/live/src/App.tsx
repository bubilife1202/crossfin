import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import RouteGraph from "./components/RouteGraph";

const API = "https://crossfin.dev";
const REFRESH_INTERVAL = 15_000;
const CROSSFIN_WALLET = "0xe4E79Ce6a1377C58f0Bb99D023908858A4DB5779";

/* ─── Types ─── */

interface Decision {
  action: "EXECUTE" | "WAIT" | "SKIP";
  confidence: number;
  reason: string;
}

interface ArbitragePair {
  coin: string;
  premiumPct: number;
  direction: string;
  decision?: Decision;
}

interface ArbitrageRaw {
  demo: boolean;
  krwUsdRate?: number;
  avgPremiumPct: number;
  executeCandidates?: number;
  marketCondition?: string;
  preview: ArbitragePair[];
  at: string;
}

interface ArbitrageData {
  average_premium: number;
  krwUsdRate?: number;
  executeCandidates: number;
  marketCondition: string;
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

interface SurvivalData {
  alive: boolean;
  state: "ALIVE" | "STOPPED";
  version: string;
  metrics: {
    totalCalls: number;
    callsToday: number;
    callsThisWeek: number;
    activeServices: number;
  };
  at: string;
}

interface OnChainTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenDecimal: string;
  timeStamp: string;
}

interface ExchangeStatus {
  exchange: string;
  status: "online" | "offline";
}

interface RouteStatusData {
  healthy: boolean;
  exchanges: ExchangeStatus[];
}

interface RouteFeeEntry {
  exchange: string;
  tradingFeePct: number;
  withdrawalFees: Record<string, number>;
}

interface RouteFeeData {
  coin: string;
  fees: RouteFeeEntry[];
}

interface RoutePairEntry {
  coin: string;
  binanceSymbol: string;
  bithumbKrw: number | null;
  binanceUsd: number | null;
  transferTimeMin: number;
  bridgeSupported: boolean;
}

interface RoutePairsData {
  krwUsdRate: number;
  pairs: RoutePairEntry[];
}

interface AcpStatusData {
  protocol: string;
  version: string;
  capabilities: string[];
  supported_exchanges: string[];
  execution_mode: string;
}

interface AcpQuoteRoutePreview {
  bridgeCoin: string;
  totalCostPct: number;
  totalTimeMinutes: number;
  estimatedOutput: number;
  estimatedInput?: number;
}

interface AcpQuoteResponse {
  protocol: string;
  version: string;
  type: "quote";
  provider: string;
  quote_id: string;
  status: string;
  optimal_route: AcpQuoteRoutePreview | null;
  alternatives: AcpQuoteRoutePreview[];
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

function timeAgoUnix(ts: number): string {
  const diff = Date.now() - ts * 1000;
  if (diff < 0) return "just now";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function shortAddr(addr: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

function usdcAmount(raw: string, decimals: string): string {
  const d = parseInt(decimals) || 6;
  const val = parseFloat(raw) / Math.pow(10, d);
  return val.toFixed(2);
}

/* ─── Route Finder helpers ─── */

const KOREAN_EXCHANGES = ["bithumb", "upbit", "coinone", "gopax"];
const ROUTE_EXCHANGES = [
  { value: "bithumb", label: "Bithumb" },
  { value: "upbit", label: "Upbit" },
  { value: "coinone", label: "Coinone" },
  { value: "gopax", label: "GoPax" },
  { value: "binance", label: "Binance" },
  { value: "okx", label: "OKX" },
  { value: "bybit", label: "Bybit" },
];

function isKoreanExchange(ex: string): boolean {
  return KOREAN_EXCHANGES.includes(ex.toLowerCase());
}

function formatRouteNum(value: string, currency: string): string {
  const raw = value.replace(/[^0-9.]/g, "");
  if (!raw) return "";
  if (currency === "KRW") {
    const num = parseInt(raw, 10);
    return isNaN(num) ? "" : num.toLocaleString("en-US");
  }
  const parts = raw.split(".");
  const intPart = parseInt(parts[0], 10);
  if (isNaN(intPart)) return "";
  const formatted = intPart.toLocaleString("en-US");
  return parts.length > 1 ? `${formatted}.${parts[1].slice(0, 2)}` : formatted;
}

function parseRouteAmount(s: string): number {
  return parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
}

function routeTimeStr(mins: number): string {
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  return `${mins}m`;
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

async function fetchOnChainTxs(): Promise<OnChainTx[]> {
  try {
    const r = await fetch(`${API}/api/onchain/usdc-transfers?limit=10`);
    if (!r.ok) return [];
    const data = (await r.json()) as { transfers?: OnChainTx[] };
    if (!data || !Array.isArray(data.transfers)) return [];
    return data.transfers;
  } catch {
    return [];
  }
}

/* ─── App ─── */

export default function App() {
  const [arb, setArb] = useState<ArbitrageData | null>(null);
  const [stats, setStats] = useState<RegistryStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [survival, setSurvival] = useState<SurvivalData | null>(null);
  const [onChainTxs, setOnChainTxs] = useState<OnChainTx[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [connected, setConnected] = useState(true);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const [routeStatus, setRouteStatus] = useState<RouteStatusData | null>(null);
  const [routeFees, setRouteFees] = useState<RouteFeeData | null>(null);
  const [routePairs, setRoutePairs] = useState<RoutePairsData | null>(null);
  const [acpStatus, setAcpStatus] = useState<AcpStatusData | null>(null);

  const [routeFrom, setRouteFrom] = useState("bithumb");
  const [routeTo, setRouteTo] = useState("binance");
  const [routeFromCur, setRouteFromCur] = useState("KRW");
  const [routeToCur, setRouteToCur] = useState("USDC");
  const [routeAmount, setRouteAmount] = useState("5,000,000");
  const [routeStrategy, setRouteStrategy] = useState<"cheapest" | "fastest" | "balanced">("cheapest");
  const [routeResult, setRouteResult] = useState<AcpQuoteResponse | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      fetchJson<ArbitrageRaw>(`${API}/api/arbitrage/demo`),
      fetchJson<RegistryStatsRaw>(`${API}/api/registry/stats`),
      fetchJson<AnalyticsRaw>(`${API}/api/analytics/overview`),
      fetchJson<HealthData>(`${API}/api/health`),
      fetchJson<SurvivalData>(`${API}/api/survival/status`),
      fetchOnChainTxs(),
      fetchJson<RouteStatusData>(`${API}/api/route/status`),
      fetchJson<RouteFeeData>(`${API}/api/route/fees?coin=XRP`),
      fetchJson<RoutePairsData>(`${API}/api/route/pairs`),
      fetchJson<AcpStatusData>(`${API}/api/acp/status`),
    ]);

    const vals = results.map((r) =>
      r.status === "fulfilled" ? r.value : null,
    );

    const [arbRaw, statsRaw, analyticsRaw, healthVal, survivalVal, txsVal, routeStatusVal, routeFeesVal, routePairsVal, acpStatusVal] =
      vals as [
        ArbitrageRaw | null,
        RegistryStatsRaw | null,
        AnalyticsRaw | null,
        HealthData | null,
        SurvivalData | null,
        OnChainTx[] | null,
        RouteStatusData | null,
        RouteFeeData | null,
        RoutePairsData | null,
        AcpStatusData | null,
      ];

    if (arbRaw) {
      setArb({
        average_premium: arbRaw.avgPremiumPct,
        krwUsdRate: arbRaw.krwUsdRate,
        executeCandidates: arbRaw.executeCandidates ?? 0,
        marketCondition: arbRaw.marketCondition ?? "neutral",
        pairs: arbRaw.preview ?? [],
      });
    }
    if (statsRaw) setStats(statsRaw.services);
    if (analyticsRaw) {
      setAnalytics({
        totalCalls: analyticsRaw.totalCalls,
        topServices: (analyticsRaw.topServices ?? []).map((s) => ({
          name: s.serviceName,
          calls: s.calls,
        })),
        recentCalls: (analyticsRaw.recentCalls ?? []).map((c) => ({
          service: c.serviceName,
          status: c.status,
          responseTime: c.responseTimeMs ?? 0,
          when: timeAgo(c.createdAt),
        })),
      });
    }
    if (healthVal) setHealth(healthVal);
    if (survivalVal) setSurvival(survivalVal);
    if (txsVal) setOnChainTxs(txsVal);
    if (routeStatusVal) setRouteStatus(routeStatusVal);
    if (routeFeesVal) setRouteFees(routeFeesVal);
    if (routePairsVal) setRoutePairs(routePairsVal);
    if (acpStatusVal) setAcpStatus(acpStatusVal);

    const successfulReads = [
      arbRaw,
      statsRaw,
      analyticsRaw,
      healthVal,
      survivalVal,
      routeStatusVal,
      routeFeesVal,
      routePairsVal,
      acpStatusVal,
    ].filter((value) => value !== null).length;

    const nextConnected = successfulReads > 0;
    setConnected(nextConnected);

    if (nextConnected) {
      setLastUpdate(new Date());
      progressRef.current = 0;
      setProgress(0);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, REFRESH_INTERVAL);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const step = 100 / (REFRESH_INTERVAL / 60);
    const id = window.setInterval(() => {
      progressRef.current = Math.min(progressRef.current + step, 100);
      setProgress(progressRef.current);
    }, 60);
    return () => window.clearInterval(id);
  }, []);

  const avgPremium = arb?.average_premium ?? 0;
  const fxRate = arb?.krwUsdRate;
  const totalServices = stats?.total ?? 0;
  const totalCalls = analytics?.totalCalls ?? 0;
  const topServices = analytics?.topServices ?? [];
  const recentCalls = analytics?.recentCalls ?? [];
  const pairs = arb?.pairs ?? [];
  const onlineExchanges = routeStatus?.exchanges?.filter(e => e.status === "online").length ?? 0;
  const totalExchangeCount = routeStatus?.exchanges?.length ?? 7;
  const bridgeCoins = (routePairs?.pairs ?? []).filter(p => p.bridgeSupported);
  const feeEntries = routeFees?.fees ?? [];
  const lowestTradingFee = feeEntries.length > 0 ? Math.min(...feeEntries.map(f => f.tradingFeePct)) : null;
  const xrpTransferTime = routePairs?.pairs?.find(p => p.coin.toUpperCase() === "XRP")?.transferTimeMin;

  const maxServiceCalls = topServices.length
    ? Math.max(...topServices.map((s) => s.calls))
    : 1;

  const routeFromSymbol = routeFromCur === "KRW" ? "₩" : "$";
  const routeOptimal = routeResult?.optimal_route;
  const routeAlts = routeResult?.alternatives ?? [];
  const routeAllRoutes = routeOptimal ? [routeOptimal, ...routeAlts] : [];
  const savingsCurrency = routeToCur === "KRW" ? "KRW" : "USD";

  const formatSavings = (value: number): string => {
    if (savingsCurrency === "KRW") return `₩${Math.max(0, Math.round(value)).toLocaleString()}`;
    return `$${Math.max(0, Math.round(value)).toLocaleString()}`;
  };

  // Calculate savings vs worst route
  const worstRoute = routeAllRoutes.length > 1 ? routeAllRoutes[routeAllRoutes.length - 1] : null;
  const averageRouteOutput = routeAllRoutes.length > 0
    ? routeAllRoutes.reduce((sum, row) => sum + row.estimatedOutput, 0) / routeAllRoutes.length
    : null;
  const savingsVsWorst = routeOptimal && worstRoute
    ? Math.round(routeOptimal.estimatedOutput - worstRoute.estimatedOutput)
    : 0;
  const savingsVsAverage = routeOptimal && averageRouteOutput !== null
    ? Math.round(routeOptimal.estimatedOutput - averageRouteOutput)
    : 0;
  const savingsPctVsWorst = routeOptimal && worstRoute && worstRoute.estimatedOutput > 0
    ? ((routeOptimal.estimatedOutput - worstRoute.estimatedOutput) / worstRoute.estimatedOutput) * 100
    : 0;

  const handleRouteFromChange = (ex: string) => {
    setRouteFrom(ex);
    const cur = isKoreanExchange(ex) ? "KRW" : "USDC";
    setRouteFromCur(cur);
    setRouteAmount(cur === "KRW" ? "5,000,000" : "1,000");
    setRouteResult(null);
    setRouteError(null);
  };

  const handleRouteToChange = (ex: string) => {
    setRouteTo(ex);
    setRouteToCur(isKoreanExchange(ex) ? "KRW" : "USDC");
    setRouteResult(null);
    setRouteError(null);
  };

  const swapRouteFromTo = () => {
    const nextFrom = routeTo;
    const nextTo = routeFrom;
    const nextFromCur = isKoreanExchange(nextFrom) ? "KRW" : "USDC";
    const nextToCur = isKoreanExchange(nextTo) ? "KRW" : "USDC";

    setRouteFrom(nextFrom);
    setRouteTo(nextTo);
    setRouteFromCur(nextFromCur);
    setRouteToCur(nextToCur);

    const currentAmount = parseRouteAmount(routeAmount);
    const defaultAmount = nextFromCur === "KRW" ? "5,000,000" : "1,000";
    if (currentAmount <= 0) {
      setRouteAmount(defaultAmount);
    } else if ((nextFromCur === "KRW" && currentAmount < 10000) || (nextFromCur !== "KRW" && currentAmount < 10)) {
      setRouteAmount(defaultAmount);
    } else {
      setRouteAmount(formatRouteNum(String(currentAmount), nextFromCur));
    }

    setRouteResult(null);
    setRouteError(null);
  };

  const handleRouteAmountChange = (raw: string) => {
    setRouteAmount(formatRouteNum(raw, routeFromCur));
  };

  const findRoute = useCallback(async () => {
    const amount = parseRouteAmount(routeAmount);
    if (routeFromCur === "KRW" && amount < 10000) {
      setRouteError("Minimum amount: ₩10,000");
      return;
    }
    if (routeFromCur !== "KRW" && amount < 10) {
      setRouteError("Minimum amount: $10");
      return;
    }
    setRouteLoading(true);
    setRouteError(null);
    setRouteResult(null);
    try {
      const res = await fetch(`${API}/api/acp/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_exchange: routeFrom,
          from_currency: routeFromCur,
          to_exchange: routeTo,
          to_currency: routeToCur,
          amount,
          strategy: routeStrategy,
        }),
      });
      const data = (await res.json()) as AcpQuoteResponse;
      if (!data.optimal_route) {
        setRouteError("No route found. Check inputs and try again.");
        return;
      }
      setRouteResult(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRouteError(`API error: ${msg}`);
    } finally {
      setRouteLoading(false);
    }
  }, [routeAmount, routeFrom, routeFromCur, routeStrategy, routeTo, routeToCur]);

  const formatRouteOutput = (val: number): string => {
    if (routeToCur === "BTC") return val.toFixed(6);
    if (routeToCur === "ETH") return val.toFixed(4);
    if (routeToCur === "KRW") return `₩${Math.round(val).toLocaleString()}`;
    return `$${Math.round(val).toLocaleString()}`;
  };

  const copyMcpConfig = () => {
    navigator.clipboard.writeText(`{
  "mcpServers": {
    "crossfin": {
      "command": "npx",
      "args": ["-y", "crossfin-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auto-run route on first load
  const hasAutoRun = useRef(false);
  useEffect(() => {
    if (!hasAutoRun.current && routePairs && routePairs.pairs.length > 0) {
      hasAutoRun.current = true;
      findRoute();
    }
  }, [findRoute, routePairs]);

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
              <span className="logoMark">⬡</span> CrossFin
            </span>
            <span className="subtitle">Asia Crypto Router for AI Agents</span>
          </div>
          <div className="headerRight">
            <span className={`connStatus ${connected ? "ok" : "err"}`}>
              <span className="connDot" />
              {connected ? "Live" : "Offline"}
            </span>
            <span className="lastUpdate">
              {lastUpdate.toLocaleTimeString()}
            </span>
          </div>
        </div>
      </header>

      <main className="main">

        {/* ═══════════════════════════════════════════════
            SECTION 1: HERO — Route Finder (moved to top)
            ═══════════════════════════════════════════════ */}
        <section className="panel heroPanel">
          <div className="heroHeadline">
            <h1 className="heroTitle">Find the cheapest path across Asian exchanges</h1>
            <p className="heroSub">
              Real-time analysis across {totalExchangeCount} exchanges × {bridgeCoins.length} bridge coins.
              Free preview — no account needed.
            </p>
          </div>

          <div className="routeInputCard">
            <div className="routeInputRow">
              <div className="routeInputGroup">
                <label htmlFor="routeFromEx">From</label>
                <select id="routeFromEx" value={routeFrom} onChange={e => handleRouteFromChange(e.target.value)}>
                  {ROUTE_EXCHANGES.map(ex => (
                    <option key={ex.value} value={ex.value}>{ex.label}</option>
                  ))}
                </select>
              </div>
              <div className="routeSwapWrap">
                <button
                  type="button"
                  className="routeSwapBtn"
                  onClick={swapRouteFromTo}
                  aria-label="Swap from and to exchanges"
                  title="Swap from and to"
                >
                  <span className="swapIcon">⇄</span>
                </button>
              </div>
              <div className="routeInputGroup">
                <label htmlFor="routeToEx">To</label>
                <select id="routeToEx" value={routeTo} onChange={e => handleRouteToChange(e.target.value)}>
                  {ROUTE_EXCHANGES.map(ex => (
                    <option key={ex.value} value={ex.value}>{ex.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="routeInputRow">
              <div className="routeInputGroup">
                <label htmlFor="routeAmountInput">Amount ({routeFromCur})</label>
                <input
                  id="routeAmountInput"
                  type="text"
                  value={routeAmount}
                  onChange={e => handleRouteAmountChange(e.target.value)}
                  placeholder={routeFromCur === "KRW" ? "5,000,000" : "1,000"}
                />
              </div>
              <div className="routeInputGroup">
                <label htmlFor="routeToCurSelect">Receive</label>
                <select id="routeToCurSelect" value={routeToCur} onChange={e => setRouteToCur(e.target.value)}>
                  {isKoreanExchange(routeTo) ? (
                    <option value="KRW">KRW</option>
                  ) : (
                    <>
                      <option value="USDC">USDC</option>
                      <option value="USDT">USDT</option>
                      <option value="BTC">BTC</option>
                      <option value="ETH">ETH</option>
                    </>
                  )}
                </select>
              </div>
            </div>
            <div className="routeStrategyRow">
              {(["cheapest", "fastest", "balanced"] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  className={`routeStrategyBtn ${routeStrategy === s ? "active" : ""}`}
                  onClick={() => setRouteStrategy(s)}
                >
                  {s === "cheapest" ? "💰 Cheapest" : s === "fastest" ? "⚡ Fastest" : "⚖️ Balanced"}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="routeFindBtn"
              onClick={findRoute}
              disabled={routeLoading}
            >
              {routeLoading ? "Analyzing routes…" : "Find Optimal Route"}
            </button>
          </div>

          {routeLoading && (
            <div className="routeLoading">
              <div className="routeSpinner" />
              <p>Evaluating {bridgeCoins.length} bridge coins across {onlineExchanges} exchanges…</p>
            </div>
          )}

          {routeError && (
            <div className="routeError">{routeError}</div>
          )}

          {routeOptimal && !routeLoading && (
            <div className="routeResultArea fadeIn">
              {/* Visual Flow */}
              <div className="routeFlow">
                <div className="flowNode flowFrom">
                  <span className="flowNodeIcon">🏦</span>
                  <span className="flowNodeName">{ROUTE_EXCHANGES.find(e => e.value === routeFrom)?.label}</span>
                  <span className="flowNodeAmount">{routeFromSymbol}{parseRouteAmount(routeAmount).toLocaleString()}</span>
                </div>
                <div className="flowArrow">
                  <div className="flowArrowLine" />
                  <div className="flowBridge">
                    <span className="flowBridgeCoin">{routeOptimal.bridgeCoin}</span>
                    <span className="flowBridgeTime">~{routeTimeStr(routeOptimal.totalTimeMinutes)}</span>
                  </div>
                  <div className="flowArrowLine" />
                </div>
                <div className="flowNode flowTo">
                  <span className="flowNodeIcon">🏦</span>
                  <span className="flowNodeName">{ROUTE_EXCHANGES.find(e => e.value === routeTo)?.label}</span>
                  <span className="flowNodeAmount flowNodeOutput">{formatRouteOutput(routeOptimal.estimatedOutput)}</span>
                </div>
              </div>

              {savingsVsWorst > 0 && (
                <div className="routeSavingsHero">
                  <span className="routeSavingsEyebrow">Estimated Savings</span>
                  <span className="routeSavingsValue">{formatSavings(savingsVsWorst)}</span>
                  <span className="routeSavingsMeta">
                    vs worst route ({savingsPctVsWorst.toFixed(2)}%)
                    {savingsVsAverage > 0 ? ` · +${formatSavings(savingsVsAverage)} vs average route` : ""}
                  </span>
                </div>
              )}

              {/* Stats row */}
              <div className="routeStatsRow">
                <div className="routeStat">
                  <span className="routeStatVal routeCostGood">{routeOptimal.totalCostPct}%</span>
                  <span className="routeStatLabel">Total Cost</span>
                </div>
                <div className="routeStat">
                  <span className="routeStatVal">{routeTimeStr(routeOptimal.totalTimeMinutes)}</span>
                  <span className="routeStatLabel">Est. Time</span>
                </div>
                {savingsVsAverage > 0 && (
                  <div className="routeStat">
                    <span className="routeStatVal routeSavings">
                      +{formatSavings(savingsVsAverage)}
                    </span>
                    <span className="routeStatLabel">vs avg route</span>
                  </div>
                )}
              </div>

              {routeAllRoutes.length > 1 && (
                <div className="routeAltSection">
                  <h3 className="routeAltTitle">All Routes Compared</h3>
                  <div className="tableWrap">
                    <table className="dataTable">
                      <thead>
                        <tr>
                          <th>Bridge</th>
                          <th>You Receive</th>
                          <th>Cost</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {routeAllRoutes.slice(0, 5).map((r: AcpQuoteRoutePreview) => {
                          const costClass = r.totalCostPct < 0.5
                            ? "routeCostGood"
                            : r.totalCostPct < 1.0
                              ? "routeCostOk"
                              : "routeCostBad";
                          return (
                            <tr key={r.bridgeCoin} className={`fadeIn ${r === routeOptimal ? "bestRoute" : ""}`}>
                              <td className="coinCell">
                                {r.bridgeCoin}{r === routeOptimal ? " ⭐" : ""}
                              </td>
                              <td className="pctCell">
                                {formatRouteOutput(r.estimatedOutput)}
                              </td>
                              <td className={costClass}>
                                {r.totalCostPct}%
                              </td>
                              <td className="dirCell">
                                {routeTimeStr(r.totalTimeMinutes)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="routeUpgradeBanner">
                <span>Full step-by-step execution guide + all {bridgeCoins.length} alternatives</span>
                <span className="routeUpgradePrice">$0.10 USDC via x402</span>
              </div>
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════════
            SECTION 1.5: RouteGraph Visualization (Live)
            ═══════════════════════════════════════════════ */}
        <section className="panel">
          <RouteGraph />
        </section>

        {/* ═══════════════════════════════════════════════
            SECTION 2: Live Price Comparison (NEW)
            ═══════════════════════════════════════════════ */}
        <section className="panel priceComparisonPanel">
          <div className="panelHeader">
            <h2 className="panelTitle">Same coin, different prices</h2>
            <span className="panelBadge">
              <span className="liveDot" />
              Live
            </span>
          </div>
          <p className="panelSubtext">
            This is why CrossFin exists — the same crypto trades at different prices on different exchanges.
            The router finds which bridge coin minimizes your total cost.
          </p>
          <div className="tableWrap">
            <table className="dataTable priceTable">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Bithumb (KRW)</th>
                  <th>Binance (USD)</th>
                  <th>Spread</th>
                  <th>Transfer</th>
                </tr>
              </thead>
              <tbody>
                {bridgeCoins.length === 0 && (
                  <tr>
                    <td colSpan={5} className="emptyRow">
                      Loading live prices…
                    </td>
                  </tr>
                )}
                {bridgeCoins.map((p) => {
                  const krwInUsd = p.bithumbKrw && fxRate ? p.bithumbKrw / fxRate : null;
                  const spreadPct = krwInUsd && p.binanceUsd
                    ? ((krwInUsd - p.binanceUsd) / p.binanceUsd * 100)
                    : null;
                  return (
                    <tr key={p.coin} className="fadeIn">
                      <td className="coinCell">{p.coin}</td>
                      <td>
                        {p.bithumbKrw != null
                          ? `₩${p.bithumbKrw.toLocaleString()}`
                          : "—"}
                      </td>
                      <td>
                        {p.binanceUsd != null
                          ? `$${p.binanceUsd.toLocaleString()}`
                          : "—"}
                      </td>
                      <td className={`pctCell ${spreadPct && spreadPct >= 0 ? "positive" : "negative"}`}>
                        {spreadPct != null
                          ? `${spreadPct >= 0 ? "+" : ""}${spreadPct.toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="dirCell">~{p.transferTimeMin}m</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            SECTION 3: Agent Demo (NEW)
            ═══════════════════════════════════════════════ */}
        <section className="panel agentDemoPanel">
          <div className="panelHeader">
            <h2 className="panelTitle">Works with AI agents</h2>
            <span className="panelBadge">MCP Protocol</span>
          </div>
          <div className="agentDemoLayout">
            <div className="agentDemoLeft">
              <h3 className="agentDemoHeading">Your agent speaks Korean crypto</h3>
              <p className="agentDemoDesc">
                Install the MCP server and your AI agent can query Korean exchanges, find optimal routes, and access 35 paid APIs — all through natural language.
              </p>
              <div className="agentDemoFeatures">
                <div className="agentDemoFeature">
                  <span className="agentFeatureIcon">🔍</span>
                  <span>Real-time routing across {totalExchangeCount} exchanges</span>
                </div>
                <div className="agentDemoFeature">
                  <span className="agentFeatureIcon">💱</span>
                  <span>Live kimchi premium tracking</span>
                </div>
                <div className="agentDemoFeature">
                  <span className="agentFeatureIcon">🇰🇷</span>
                  <span>Korean language native</span>
                </div>
                <div className="agentDemoFeature">
                  <span className="agentFeatureIcon">⚡</span>
                  <span>35 paid APIs via x402 micropayments</span>
                </div>
              </div>
            </div>
            <div className="agentDemoRight">
              <div className="agentChatDemo">
                <div className="chatBubble user">
                  빗썸에서 바이낸스로 500만원 USDC 만들려면 가장 싼 방법이 뭐야?
                </div>
                <div className="chatBubble agent">
                  <div className="chatToolCall">
                    <span className="toolIcon">⚡</span>
                    <code>find_optimal_route</code>
                  </div>
                  <strong>최적 경로: AVAX 브릿지</strong><br/>
                  빗썸 AVAX 매수 → 바이낸스 전송(~3분) → USDC 매도<br/>
                  <span className="chatHighlight">비용 0.07% | 수령 $3,452</span>
                </div>
                <div className="chatBubble user">
                  지금 김치 프리미엄은?
                </div>
                <div className="chatBubble agent">
                  <div className="chatToolCall">
                    <span className="toolIcon">⚡</span>
                    <code>get_kimchi_premium</code>
                  </div>
                  평균 김프 <strong>{avgPremium >= 0 ? "+" : ""}{avgPremium.toFixed(2)}%</strong>
                  {pairs.length > 0 && pairs[0] && (
                    <> · 최고 {pairs.reduce((a, b) => a.premiumPct > b.premiumPct ? a : b).coin} {pairs.reduce((a, b) => a.premiumPct > b.premiumPct ? a : b).premiumPct.toFixed(2)}%</>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            SECTION 4: Install CTA (NEW)
            ═══════════════════════════════════════════════ */}
        <section className="panel installPanel">
          <div className="installContent">
            <h2 className="installTitle">Add to Claude Desktop</h2>
            <p className="installSub">Copy this config and paste into your <code>claude_desktop_config.json</code></p>
            <div className="installCodeBlock">
              <pre>{`{
  "mcpServers": {
    "crossfin": {
      "command": "npx",
      "args": ["-y", "crossfin-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}`}</pre>
              <button type="button" className="copyBtn" onClick={copyMcpConfig}>
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <p className="installNote">
              Free tools work without EVM key. Paid tools ($0.01–$0.10/call) need a Base wallet with USDC.
            </p>
            <div className="installLinks">
              <a href="https://www.npmjs.com/package/crossfin-mcp" target="_blank" rel="noopener noreferrer" className="installLink">
                npm: crossfin-mcp
              </a>
              <a href="https://github.com/bubilife1202/crossfin" target="_blank" rel="noopener noreferrer" className="installLink">
                GitHub
              </a>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            SECTION 5: Metrics row (condensed)
            ═══════════════════════════════════════════════ */}
        <section className="metricsRow">
          <MetricCard
            label="Kimchi Premium"
            value={`${avgPremium >= 0 ? "+" : ""}${avgPremium.toFixed(2)}%`}
            tone={avgPremium >= 0 ? "positive" : "negative"}
            sub="KR↔Global avg spread"
          />
          <MetricCard
            label="USD/KRW"
            value={
              typeof fxRate === "number" && Number.isFinite(fxRate)
                ? fxRate.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : "—"
            }
            tone="neutral"
            sub="Real-time FX"
          />
          <MetricCard
            label="Exchanges"
            value={`${onlineExchanges}/${totalExchangeCount}`}
            tone={onlineExchanges === totalExchangeCount ? "positive" : "negative"}
            sub="Online now"
          />
          <MetricCard
            label="API Calls"
            value={totalCalls.toLocaleString()}
            tone="neutral"
            sub="Total requests"
          />
          <MetricCard
            label="On-Chain"
            value={String(onChainTxs.length)}
            tone={onChainTxs.length > 0 ? "positive" : "neutral"}
            sub="USDC payments"
          />
        </section>

        {/* ═══════════════════════════════════════════════
            SECTION 6: AI Decision Layer
            ═══════════════════════════════════════════════ */}
        <section className="panel decisionPanel">
          <div className="panelHeader">
            <h2 className="panelTitle">AI Decision Layer</h2>
            <div className="decisionBadges">
              {arb?.marketCondition && (
                <span
                  className={`marketBadge ${arb.marketCondition}`}
                >
                  {arb.marketCondition === "favorable"
                    ? "🟢 Favorable"
                    : arb.marketCondition === "neutral"
                      ? "🟡 Neutral"
                      : "🔴 Unfavorable"}
                </span>
              )}
              <span className="panelBadge">
                <span className="liveDot" />
                Live decisions
              </span>
            </div>
          </div>
          <p className="decisionSubtext">
            Real-time arbitrage decisions — actionable intelligence with confidence scoring.
          </p>
          <div className="decisionGrid">
            {pairs.length === 0 && (
              <p className="emptyText">Loading decisions…</p>
            )}
            {pairs.map((p) => (
              <DecisionCard key={p.coin} pair={p} />
            ))}
          </div>
        </section>

        {/* On-Chain Payment Feed */}
        {onChainTxs.length > 0 && (
          <section className="panel onchainPanel">
            <div className="panelHeader">
              <h2 className="panelTitle">On-Chain Payments</h2>
              <a
                href={`https://basescan.org/address/${CROSSFIN_WALLET}`}
                target="_blank"
                rel="noopener noreferrer"
                className="panelBadge panelBadgeLink"
              >
                View on BaseScan ↗
              </a>
            </div>
            <div className="txList">
              <div className="txHeader">
                <span>Direction</span>
                <span>Amount</span>
                <span>Counterparty</span>
                <span>When</span>
              </div>
              {onChainTxs.slice(0, 8).map((tx) => {
                const isIncoming =
                  tx.to.toLowerCase() === CROSSFIN_WALLET.toLowerCase();
                return (
                  <a
                    key={tx.hash}
                    href={`https://basescan.org/tx/${tx.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="txRow fadeIn"
                  >
                    <span
                      className={`txDirection ${isIncoming ? "incoming" : "outgoing"}`}
                    >
                      {isIncoming ? "⬇ Received" : "⬆ Sent"}
                    </span>
                    <span className="txAmount">
                      ${usdcAmount(tx.value, tx.tokenDecimal)} USDC
                    </span>
                    <span className="txAddr">
                      {shortAddr(isIncoming ? tx.from : tx.to)}
                    </span>
                    <span className="txWhen">
                      {timeAgoUnix(parseInt(tx.timeStamp))}
                    </span>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {/* Routing details (collapsed) */}
        <div className="routingSection">
          <section className="panel routingPanel">
            <div className="panelHeader">
              <h2 className="panelTitle">Exchange Network</h2>
              <span className="panelBadge">
                {onlineExchanges}/{totalExchangeCount} Online
              </span>
            </div>
            <div className="exchangeGrid">
              {(routeStatus?.exchanges ?? []).length === 0 && (
                <p className="emptyText">Loading exchanges...</p>
              )}
              {(routeStatus?.exchanges ?? []).map((ex) => {
                const isKorea = ["bithumb", "upbit", "coinone", "gopax"].includes(
                  ex.exchange.toLowerCase(),
                );
                return (
                  <div key={ex.exchange} className={`exchangeCard ${ex.status}`}>
                    <div className="exchangeCardTop">
                      <span className="exchangeName">{ex.exchange}</span>
                      <span
                        className={`statusDotSmall ${ex.status === "online" ? "green" : "red"}`}
                      />
                    </div>
                    <span className="exchangeRegion">
                      {isKorea ? "Korea" : "Global"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader">
              <h2 className="panelTitle">Transfer Fees (XRP)</h2>
              <span className="panelBadge">Compare routes</span>
            </div>
            {acpStatus && (
              <div className="acpCard acpCardInline">
                <span className="acpBadge">ACP {acpStatus.version}</span>
                <span className="acpMode">{acpStatus.execution_mode}</span>
                <div className="acpCapabilities">
                  {acpStatus.capabilities.map((cap) => (
                    <span key={cap} className="acpCapBadge">{cap}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="tableWrap">
              <table className="dataTable">
                <thead>
                  <tr>
                    <th>Exchange</th>
                    <th>Trading Fee %</th>
                    <th>XRP Withdrawal</th>
                    <th>Transfer Time</th>
                  </tr>
                </thead>
                <tbody>
                  {feeEntries.length === 0 && (
                    <tr>
                      <td colSpan={4} className="emptyRow">
                        Loading fees...
                      </td>
                    </tr>
                  )}
                  {feeEntries.map((f) => (
                    <tr key={f.exchange} className="fadeIn">
                      <td className="coinCell">{f.exchange}</td>
                      <td
                        className={`pctCell ${f.tradingFeePct === lowestTradingFee ? "positive" : ""}`}
                      >
                        {f.tradingFeePct.toFixed(3)}%
                      </td>
                      <td className="feeCell">
                        {f.withdrawalFees?.XRP != null
                          ? `${f.withdrawalFees.XRP} XRP`
                          : "\u2014"}
                      </td>
                      <td className="dirCell">
                        {xrpTransferTime != null
                          ? `~${xrpTransferTime} min`
                          : "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </div>

        {/* Kimchi Premium Table */}
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

        {/* Agent Survival */}
        {survival && (
          <section
            className={`panel survivalSection ${survival.state === "ALIVE" ? "alive" : "stopped"}`}
          >
            <div className="survivalHeader">
              <h2 className="panelTitle">System Status</h2>
              <span
                className={`survivalBadge ${survival.state === "ALIVE" ? "alive" : "stopped"}`}
              >
                <span className="survivalDot" />
                {survival.state}
              </span>
            </div>
            <div className="survivalMetrics">
              <div className="survivalMiniCard">
                <span className="metricLabel">Calls Today</span>
                <span className="metricValue neutral">
                  {survival.metrics.callsToday.toLocaleString()}
                </span>
              </div>
              <div className="survivalMiniCard">
                <span className="metricLabel">This Week</span>
                <span className="metricValue neutral">
                  {survival.metrics.callsThisWeek.toLocaleString()}
                </span>
              </div>
              <div className="survivalMiniCard">
                <span className="metricLabel">Active Services</span>
                <span className="metricValue neutral">
                  {survival.metrics.activeServices.toLocaleString()}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Two columns: Top Services + Recent Calls */}
        <section className="twoCol">
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

        {/* System Health */}
        <section className="healthRow">
          <div className="healthCard">
            <span
              className={`healthDot ${health?.status === "ok" ? "green" : "red"}`}
            />
            <div className="healthInfo">
              <span className="healthLabel">System</span>
              <span className="healthValue">
                {health?.status === "ok" ? "Operational" : "Degraded"}
              </span>
            </div>
          </div>
          <div className="healthCard">
            <span className="healthIcon">⚡</span>
            <div className="healthInfo">
              <span className="healthLabel">Version</span>
              <span className="healthValue">{health?.version ?? "—"}</span>
            </div>
          </div>
          <div className="healthCard">
            <span className="healthIcon">◈</span>
            <div className="healthInfo">
              <span className="healthLabel">Payment</span>
              <span className="healthValue">x402 USDC/Base</span>
            </div>
          </div>
          <div className="healthCard">
            <span className="healthIcon">⬡</span>
            <div className="healthInfo">
              <span className="healthLabel">Services</span>
              <span className="healthValue">{totalServices}</span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="footerInner">
          <span className="footerBrand">CrossFin — Asia Crypto Router for AI Agents</span>
          <div className="footerLinks">
            <a
              href="https://crossfin.dev"
              target="_blank"
              rel="noopener noreferrer"
            >
              Gateway
            </a>
            <a
              href="https://github.com/bubilife1202/crossfin"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/crossfin-mcp"
              target="_blank"
              rel="noopener noreferrer"
            >
              npm
            </a>
            <a
              href={`https://basescan.org/address/${CROSSFIN_WALLET}`}
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

function DecisionCard({ pair }: { pair: ArbitragePair }) {
  const d = pair.decision;
  const actionClass = d
    ? d.action === "EXECUTE"
      ? "execute"
      : d.action === "WAIT"
        ? "wait"
        : "skip"
    : "skip";

  return (
    <div className={`decisionCard ${actionClass}`}>
      <div className="decisionCardTop">
        <span className="decisionCoin">{pair.coin}</span>
        <span className={`decisionActionBadge ${actionClass}`}>
          {d?.action ?? "—"}
        </span>
      </div>
      <div className="decisionPremium">
        <span className={actionClass === "skip" ? "negative" : "positive"}>
          {Math.abs(pair.premiumPct).toFixed(3)}%
        </span>
        <span className="decisionDir">{pair.direction}</span>
      </div>
      {d && (
        <div className="decisionMeta">
          <div className="confidenceBar">
            <div
              className={`confidenceFill ${actionClass}`}
              style={{ width: `${Math.round(d.confidence * 100)}%` }}
            />
          </div>
          <span className="confidenceLabel">
            {Math.round(d.confidence * 100)}% confidence
          </span>
          <span className="decisionReason">{d.reason}</span>
        </div>
      )}
    </div>
  );
}

function rtClass(ms: number): string {
  if (ms < 200) return "fast";
  if (ms < 500) return "medium";
  return "slow";
}
