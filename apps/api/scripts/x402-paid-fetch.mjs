import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'
import { decodePaymentRequiredHeader } from '@x402/core/http'

function requireEnv(name) {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`Missing env var: ${name}`)
  return v.trim()
}

function basescanLink(networkId, txHash) {
  if (!txHash) return null
  if (networkId === 'eip155:84532') return `https://sepolia.basescan.org/tx/${txHash}`
  if (networkId === 'eip155:8453') return `https://basescan.org/tx/${txHash}`
  return null
}

const API_URL = (process.env.API_URL || 'https://crossfin.dev/api/premium/enterprise').trim()
const EVM_PRIVATE_KEY = requireEnv('EVM_PRIVATE_KEY')
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.REQUEST_TIMEOUT_MS || '15000'))

function fetchWithTimeout(input, init) {
  const hasSignal = Boolean(init && typeof init === 'object' && 'signal' in init && init.signal)
  const signal = hasSignal ? init.signal : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return fetch(input, { ...(init || {}), signal })
}

const signer = privateKeyToAccount(EVM_PRIVATE_KEY)
const client = new x402Client()
registerExactEvmScheme(client, { signer })

const paidFetch = wrapFetchWithPayment(fetchWithTimeout, client)
const httpClient = new x402HTTPClient(client)

console.log(`payer=${signer.address}`)
console.log(`url=${API_URL}`)

try {
  const first = await fetchWithTimeout(API_URL, { method: 'GET' })
  console.log(`first_status=${first.status}`)
  const paymentRequired = first.headers.get('PAYMENT-REQUIRED') || first.headers.get('payment-required')
  if (paymentRequired) console.log('payment_required_header=true')

  if (paymentRequired) {
    try {
      const decoded = decodePaymentRequiredHeader(paymentRequired)
      console.log('payment_required_decoded=true')
      console.log(JSON.stringify(decoded, null, 2))

      const amt = decoded?.accepts?.[0]?.amount
      if (typeof amt === 'string') {
        const atomic = Number(amt)
        if (Number.isFinite(atomic)) {
          const usdc = atomic / 1_000_000
          console.log(`required_usdc=${usdc.toFixed(6)}`)

           if (atomic < 20_000_000) {
             console.error('micro_price_notice=true')
             console.error('hint=you_are_testing_a_micro_endpoint')
           }
         }
       }
     } catch {
       console.log('payment_required_decoded=false')
     }
  }

  const res = await paidFetch(API_URL, { method: 'GET' })
  console.log(`final_status=${res.status}`)

  const text = await res.text()
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text)
  }

  if (!res.ok) {
    console.error('paid_request_failed=true')
    console.error('most_likely_reason=insufficient_testnet_usdc')
    process.exit(1)
  }

  const settle = httpClient.getPaymentSettleResponse((name) => res.headers.get(name))
  if (!settle) {
    console.log('payment_settled=unknown')
    process.exit(0)
  }

  const txHash = settle.transactionHash || settle.txHash || settle.transaction
  const networkId = settle.networkId || settle.network
  console.log('payment_settled=true')
  console.log(JSON.stringify(settle, null, 2))

  const link = basescanLink(networkId, txHash)
  if (link) console.log(`basescan=${link}`)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
