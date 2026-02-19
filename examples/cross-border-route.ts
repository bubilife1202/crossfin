import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const CROSSFIN = "https://crossfin.dev";

const key = process.env.EVM_PRIVATE_KEY;
if (!key) {
  console.error("Set EVM_PRIVATE_KEY (Base wallet with USDC)");
  process.exit(1);
}

const signer = privateKeyToAccount(key as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer });
const paidFetch = wrapFetchWithPayment(fetch, client);

const from = process.argv[2] || "bithumb:KRW";
const to = process.argv[3] || "binance:USDC";
const amount = process.argv[4] || "5000000";

async function findRoute() {
  const params = new URLSearchParams({ from, to, amount, strategy: "cheapest" });

  const res = await paidFetch(`${CROSSFIN}/api/premium/route/find?${params}`);
  if (!res.ok) {
    console.error(`Error: ${res.status}`);
    return;
  }

  const data = await res.json();
  const { optimal, alternatives, meta } = data;

  if (!optimal) {
    console.log("No route found");
    return;
  }

  console.log(`\n${from} → ${to} (${Number(amount).toLocaleString()})\n`);
  console.log(`Best: ${optimal.bridgeCoin}`);
  console.log(`  Cost: ${optimal.totalCostPct.toFixed(2)}% | Time: ~${optimal.totalTimeMinutes}min`);
  console.log(`  Output: ${optimal.steps?.[optimal.steps.length - 1]?.outputAmount ?? "N/A"}`);

  if (alternatives.length > 0) {
    console.log(`\nAlternatives:`);
    for (const alt of alternatives.slice(0, 3)) {
      console.log(`  ${alt.bridgeCoin}: ${alt.totalCostPct.toFixed(2)}% | ~${alt.totalTimeMinutes}min`);
    }
  }

  console.log(`\nData: ${meta.dataFreshness} | Fees: ${meta.feesSource} | Evaluated: ${meta.routesEvaluated} routes`);
}

findRoute();
