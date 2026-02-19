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
  totalCallsAll?: number;
  totalCallsExternal?: number;
  topServices: TopServiceRaw[];
  topServicesExternal?: TopServiceRaw[];
  recentCalls: RecentCallRaw[];
  recentCallsExternal?: RecentCallRaw[];
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
  totalCallsExternal: number;
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
    externalTotalCalls?: number;
    externalCallsToday?: number;
    externalCallsThisWeek?: number;
    activeServices: number;
  };
  traffic?: {
    all?: {
      totalCalls: number;
      callsToday: number;
      callsThisWeek: number;
    };
    external?: {
      totalCalls: number;
      callsToday: number;
      callsThisWeek: number;
    };
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
  transferTimes?: Record<string, number>;
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

/* ─── Helpers ─── */

function timeAgo(iso: string): string {
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);
  const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);
  const parsedMs = parsed.getTime();
  if (!Number.isFinite(parsedMs)) return "—";
  const diff = Date.now() - parsedMs;
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

type ExchangeRegion = "korean" | "regional" | "global";

const ROUTE_EXCHANGES = [
  { value: "bithumb", label: "Bithumb", region: "korean", fiat: "KRW" },
  { value: "upbit", label: "Upbit", region: "korean", fiat: "KRW" },
  { value: "coinone", label: "Coinone", region: "korean", fiat: "KRW" },
  { value: "gopax", label: "GoPax", region: "korean", fiat: "KRW" },
  { value: "bitflyer", label: "bitFlyer", region: "regional", fiat: "JPY" },
  { value: "wazirx", label: "WazirX", region: "regional", fiat: "INR" },
  { value: "binance", label: "Binance", region: "global", fiat: "USDC" },
  { value: "okx", label: "OKX", region: "global", fiat: "USDC" },
  { value: "bybit", label: "Bybit", region: "global", fiat: "USDC" },
] as const;

function getExchangeMeta(ex: string) {
  return ROUTE_EXCHANGES.find((item) => item.value === ex.toLowerCase()) ?? null;
}

function getExchangeRegion(ex: string): ExchangeRegion {
  return getExchangeMeta(ex)?.region ?? "global";
}

function formatExchangeLabel(ex: string): string {
  const exchange = ex.toLowerCase();
  return ROUTE_EXCHANGES.find((item) => item.value === exchange)?.label ?? ex;
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
      const totalCallsAll = analyticsRaw.totalCallsAll ?? analyticsRaw.totalCalls ?? 0;
      const totalCallsExternal = analyticsRaw.totalCallsExternal ?? analyticsRaw.totalCalls ?? 0;
      setAnalytics({
        totalCalls: totalCallsAll,
        totalCallsExternal,
        topServices: (analyticsRaw.topServicesExternal ?? analyticsRaw.topServices ?? []).map((s) => ({
          name: s.serviceName,
          calls: s.calls,
        })),
        recentCalls: (analyticsRaw.recentCallsExternal ?? analyticsRaw.recentCalls ?? []).map((c) => ({
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
  const externalCalls = analytics?.totalCallsExternal ?? 0;
  const topServices = analytics?.topServices ?? [];
  const recentCalls = analytics?.recentCalls ?? [];
  const survivalExternalToday = survival?.metrics.externalCallsToday ?? survival?.traffic?.external?.callsToday ?? 0;
  const survivalExternalWeek = survival?.metrics.externalCallsThisWeek ?? survival?.traffic?.external?.callsThisWeek ?? 0;
  const pairs = arb?.pairs ?? [];
  const routeExchangeRows = routeStatus?.exchanges ?? [];
  const onlineExchanges = routeExchangeRows.filter((e) => e.status === "online").length;
  const totalExchangeCount = routeExchangeRows.length || ROUTE_EXCHANGES.length;
  const koreaHubExchanges = routeExchangeRows.filter((e) => getExchangeRegion(e.exchange) === "korean");
  const regionalHubExchanges = routeExchangeRows.filter((e) => getExchangeRegion(e.exchange) === "regional");
  const globalHubExchanges = routeExchangeRows.filter((e) => getExchangeRegion(e.exchange) === "global");
  const defaultKoreaExchangeCount = ROUTE_EXCHANGES.filter((e) => e.region === "korean").length;
  const defaultRegionalExchangeCount = ROUTE_EXCHANGES.filter((e) => e.region === "regional").length;
  const defaultGlobalExchangeCount = ROUTE_EXCHANGES.filter((e) => e.region === "global").length;
  const bridgeCoins = (routePairs?.pairs ?? []).filter(p => p.bridgeSupported);
  const feeEntries = routeFees?.fees ?? [];
  const lowestTradingFee = feeEntries.length > 0 ? Math.min(...feeEntries.map(f => f.tradingFeePct)) : null;
  const lowestFeeExchange = lowestTradingFee == null
    ? null
    : feeEntries.find((f) => f.tradingFeePct === lowestTradingFee) ?? null;
  const xrpTransferTimeFallback = routePairs?.pairs?.find(p => p.coin.toUpperCase() === "XRP")?.transferTimeMin;
  const fastestBridge = bridgeCoins.length > 0
    ? bridgeCoins.reduce((fastest, current) =>
      current.transferTimeMin < fastest.transferTimeMin ? current : fastest,
    )
    : null;

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

        <section className="panel routeGraphPanel">
          <RouteGraph />
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
                  <span>Live route spread monitoring</span>
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
                  지금 기준으로 어떤 브릿지 코인이 가장 빠르고 수수료가 낮아?
                </div>
                <div className="chatBubble agent">
                  <div className="chatToolCall">
                    <span className="toolIcon">⚡</span>
                    <code>compare_exchange_prices</code>
                  </div>
                  <strong>
                    가장 빠른 브릿지: {fastestBridge?.coin ?? "XRP"}
                    {fastestBridge ? ` (~${fastestBridge.transferTimeMin}분)` : ""}
                  </strong>
                  <br />
                  최저 거래 수수료 거래소: {lowestFeeExchange ? formatExchangeLabel(lowestFeeExchange.exchange) : "—"}
                  {lowestTradingFee != null ? ` (${lowestTradingFee.toFixed(3)}%)` : ""}
                </div>
              </div>
            </div>
          </div>
        </section>



        {/* ═══════════════════════════════════════════════
            SECTION 5: Metrics row (condensed)
            ═══════════════════════════════════════════════ */}
        <section className="metricsRow">
          <MetricCard
            label="Route Spread"
            value={`${avgPremium >= 0 ? "+" : ""}${avgPremium.toFixed(2)}%`}
            tone={avgPremium >= 0 ? "positive" : "negative"}
            sub="KRW↔Global routing edge"
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
            value={externalCalls.toLocaleString()}
            tone="neutral"
            sub="External traffic"
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
            Signals are computed from the Bithumb (KRW) vs Binance (USD) price gap, then scored into EXECUTE/WAIT/SKIP decisions.
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
              <h2 className="panelTitle">Routing Network Hubs</h2>
              <span className="panelBadge">
                {onlineExchanges}/{totalExchangeCount} Online
              </span>
            </div>
            <p className="panelSubtext">
              Korea: Bithumb, Upbit, Coinone, GoPax · Regional Fiat: bitFlyer (JPY), WazirX (INR) · Global: Binance, OKX, Bybit
            </p>
            <div className="exchangeHubGrid">
              <div className="exchangeHubCard korea">
                <div className="exchangeHubHead">
                  <div>
                    <h3 className="exchangeHubTitle">Korea Hub</h3>
                    <p className="exchangeHubDesc">KRW entry and local liquidity venues</p>
                  </div>
                  <span className="exchangeHubMeta">
                    {koreaHubExchanges.filter((e) => e.status === "online").length}/{koreaHubExchanges.length || defaultKoreaExchangeCount} online
                  </span>
                </div>
                <div className="exchangeHubList">
                  {koreaHubExchanges.length === 0 && <p className="emptyText">Loading hub...</p>}
                  {koreaHubExchanges.map((ex) => (
                    <div key={`kr-${ex.exchange}`} className={`exchangePill ${ex.status}`}>
                      <span className="exchangePillName">{formatExchangeLabel(ex.exchange)}</span>
                      <span className={`statusDotSmall ${ex.status === "online" ? "green" : "red"}`} />
                      <span className="exchangePillStatus">{ex.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="exchangeHubCard regional">
                <div className="exchangeHubHead">
                  <div>
                    <h3 className="exchangeHubTitle">Regional Fiat Hub</h3>
                    <p className="exchangeHubDesc">JPY/INR local rails (Japan, India)</p>
                  </div>
                  <span className="exchangeHubMeta">
                    {regionalHubExchanges.filter((e) => e.status === "online").length}/{regionalHubExchanges.length || defaultRegionalExchangeCount} online
                  </span>
                </div>
                <div className="exchangeHubList">
                  {regionalHubExchanges.length === 0 && <p className="emptyText">Loading hub...</p>}
                  {regionalHubExchanges.map((ex) => (
                    <div key={`rg-${ex.exchange}`} className={`exchangePill ${ex.status}`}>
                      <span className="exchangePillName">{formatExchangeLabel(ex.exchange)}</span>
                      <span className={`statusDotSmall ${ex.status === "online" ? "green" : "red"}`} />
                      <span className="exchangePillStatus">{ex.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="exchangeHubCard global">
                <div className="exchangeHubHead">
                  <div>
                    <h3 className="exchangeHubTitle">Global Hub</h3>
                    <p className="exchangeHubDesc">USDC settlement and bridge exits</p>
                  </div>
                  <span className="exchangeHubMeta">
                    {globalHubExchanges.filter((e) => e.status === "online").length}/{globalHubExchanges.length || defaultGlobalExchangeCount} online
                  </span>
                </div>
                <div className="exchangeHubList">
                  {globalHubExchanges.length === 0 && <p className="emptyText">Loading hub...</p>}
                  {globalHubExchanges.map((ex) => (
                    <div key={`gl-${ex.exchange}`} className={`exchangePill ${ex.status}`}>
                      <span className="exchangePillName">{formatExchangeLabel(ex.exchange)}</span>
                      <span className={`statusDotSmall ${ex.status === "online" ? "green" : "red"}`} />
                      <span className="exchangePillStatus">{ex.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader">
              <h2 className="panelTitle">Exchange Fee Comparison</h2>
              <span className="panelBadge">9 exchanges</span>
            </div>
            <p className="panelSub" style={{ color: "var(--text-muted, #888)", fontSize: "0.82rem", margin: "-0.25rem 0 0.75rem" }}>
              How much it costs to route through each exchange — using XRP as the bridge coin (fastest, ~30 sec transfer).
            </p>
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
                    <th>Trading Fee</th>
                    <th>Withdrawal Cost</th>
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
                  {feeEntries.map((f) => {
                    const xrpEta = f.transferTimes?.XRP ?? xrpTransferTimeFallback;
                    return (
                      <tr key={f.exchange} className="fadeIn">
                        <td className="coinCell">{formatExchangeLabel(f.exchange)}</td>
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
                        <td className="etaCell">
                          {xrpEta != null
                            ? `~${xrpEta} min`
                            : "\u2014"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

        </div>

        <section className="panel">
          <div className="panelHeader">
            <h2 className="panelTitle">Korea vs Global Price Gap</h2>
            <span className="panelBadge">
              <span className="liveDot" />
              Auto-refresh 15s
            </span>
          </div>
          <p className="panelSub" style={{ color: "var(--text-muted, #888)", fontSize: "0.82rem", margin: "-0.25rem 0 0.75rem" }}>
            Same coin, different price across exchanges — the gap that makes cross-border routing profitable.
          </p>
          <div className="tableWrap">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Price Gap</th>
                  <th>Where It's Cheaper</th>
                  <th>Signal</th>
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
                    <td className="dirCell">
                      {p.premiumPct >= 0 ? "Cheaper on Global" : "Cheaper in Korea"}
                    </td>
                    <td>
                      <span className={`statusPill ${(p.decision?.action ?? "MONITOR") === "EXECUTE" ? "active" : ""}`}>
                        <span className="statusDotSmall" />
                        {(p.decision?.action ?? "MONITOR") === "EXECUTE" ? "ROUTE NOW" : (p.decision?.action ?? "MONITOR")}
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
                <span className="metricLabel">Last 24h</span>
                <span className="metricValue neutral">
                  {survivalExternalToday.toLocaleString()}
                </span>
              </div>
              <div className="survivalMiniCard">
                <span className="metricLabel">Last 7d</span>
                <span className="metricValue neutral">
                  {survivalExternalWeek.toLocaleString()}
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
  const directionText = getSpreadDirectionText(pair.direction);

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
        <span className="decisionDir">{directionText}</span>
      </div>
      <span className="decisionBasis">Bithumb (KRW) vs Binance (USD) price gap</span>
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
          <span className="decisionReason">{clarifyDecisionReason(d.reason)}</span>
        </div>
      )}
    </div>
  );
}

function getSpreadDirectionText(direction: string): string {
  const raw = direction.trim().toLowerCase();
  if (raw.includes("premium")) return "Korean exchange price > global";
  if (raw.includes("discount")) return "Korean exchange price < global";
  return "Korean vs global price gap";
}

function clarifyDecisionReason(reason: string): string {
  return reason
    .replace(
      /Korea premium setup \(buy global -> sell Korea\)/gi,
      "Bithumb KRW > Binance USD (buy global -> sell Korea)",
    )
    .replace(
      /Korea discount setup \(buy Korea -> sell global\)/gi,
      "Bithumb KRW < Binance USD (buy Korea -> sell global)",
    );
}

function rtClass(ms: number): string {
  if (ms < 200) return "fast";
  if (ms < 500) return "medium";
  return "slow";
}
