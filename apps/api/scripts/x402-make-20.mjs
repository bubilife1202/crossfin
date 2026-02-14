import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import { decodePaymentRequiredHeader } from '@x402/core/http'
import { createPublicClient, http, formatEther, formatUnits } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const X402_NETWORK = (process.env.X402_NETWORK || 'eip155:8453').trim()
const API_URL = (process.env.API_URL || 'https://crossfin.dev/api/premium/enterprise').trim()
const RPC_URL = (
  process.env.RPC_URL ||
  (X402_NETWORK === 'eip155:84532' ? 'https://sepolia.base.org' : 'https://mainnet.base.org')
).trim()
const USDC = (
  process.env.USDC_ADDRESS ||
  (X402_NETWORK === 'eip155:84532'
    ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    : '0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913')
).trim()
const USDC_DECIMALS = Number(process.env.USDC_DECIMALS || '6')
const MIN_USDC = Number(process.env.MIN_USDC || '20')
const POLL_MS = Math.max(2000, Number(process.env.POLL_MS || '12000'))
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.REQUEST_TIMEOUT_MS || '15000'))

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function basescanLink(networkId, txHash) {
  if (!txHash) return null
  if (networkId === 'eip155:84532') return `https://sepolia.basescan.org/tx/${txHash}`
  if (networkId === 'eip155:8453') return `https://basescan.org/tx/${txHash}`
  return null
}

function fetchWithTimeout(input, init) {
  const hasSignal = Boolean(init && typeof init === 'object' && 'signal' in init && init.signal)
  const signal = hasSignal ? init.signal : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return fetch(input, { ...(init || {}), signal })
}

const pk = generatePrivateKey()
const account = privateKeyToAccount(pk)

console.log('step=wallet_created')
console.log(`address=${account.address}`)
console.log(`private_key=${pk}`)
console.log('note=do_not_share_private_key')

console.log('step=fund_wallet')
console.log(`x402_network=${X402_NETWORK}`)
if (X402_NETWORK === 'eip155:84532') {
  console.log('network=Base Sepolia (chainId 84532)')
  console.log('usdc_faucet=https://faucet.circle.com')
} else {
  console.log('network=Base Mainnet (chainId 8453)')
  console.log('note=fund_wallet_with_usdc_on_base')
}
console.log('note=eth_not_required_for_x402_settlement (gas paid by facilitator)')

const publicClient = createPublicClient({
  chain: X402_NETWORK === 'eip155:84532' ? baseSepolia : base,
  transport: http(RPC_URL),
})

async function balances() {
  const [eth, usdc] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: USDC,
      abi: [
        {
          type: 'function',
          name: 'balanceOf',
          stateMutability: 'view',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: 'balance', type: 'uint256' }],
        },
      ],
      functionName: 'balanceOf',
      args: [account.address],
    }),
  ])

  const ethF = Number(formatEther(eth))
  const usdcF = Number(formatUnits(usdc, USDC_DECIMALS))
  return { ethF, usdcF, ethRaw: eth, usdcRaw: usdc }
}

console.log('step=waiting_for_funds')
console.log(`min_usdc=${MIN_USDC}`)
console.log('min_eth=0 (gas paid by facilitator)')

while (true) {
  const b = await balances()
  console.log(`eth=${b.ethF.toFixed(6)} usdc=${b.usdcF.toFixed(6)}`)

  if (b.usdcF >= MIN_USDC) break
  await sleep(POLL_MS)
}

console.log('step=funds_ready')

const client = new x402Client()
registerExactEvmScheme(client, { signer: account })

const paidFetch = wrapFetchWithPayment(fetchWithTimeout, client)
const httpClient = new x402HTTPClient(client)

const first = await fetchWithTimeout(API_URL, { method: 'GET' })
const pr = first.headers.get('PAYMENT-REQUIRED') || first.headers.get('payment-required')
if (pr) {
  try {
    const decoded = decodePaymentRequiredHeader(pr)
    const amt = decoded?.accepts?.[0]?.amount
    if (typeof amt === 'string') {
      const atomic = Number(amt)
      if (Number.isFinite(atomic)) {
        const usdc = atomic / 1_000_000
        console.log(`required_usdc=${usdc.toFixed(6)}`)
      }
    }
  } catch {
  }
}

console.log('step=attempt_paid_call')
const res = await paidFetch(API_URL, { method: 'GET' })
console.log(`final_status=${res.status}`)

const bodyText = await res.text()
try {
  console.log(JSON.stringify(JSON.parse(bodyText), null, 2))
} catch {
  console.log(bodyText)
}

if (!res.ok) {
  console.error('paid_request_failed=true')
  process.exit(1)
}

const settle = httpClient.getPaymentSettleResponse((name) => res.headers.get(name))
const txHash = settle.transactionHash || settle.txHash || settle.transaction
const networkId = settle.networkId || settle.network
console.log('payment_settled=true')
console.log(JSON.stringify(settle, null, 2))

const link = basescanLink(networkId, txHash)
if (link) console.log(`basescan=${link}`)
