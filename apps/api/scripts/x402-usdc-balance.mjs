import { createPublicClient, http, formatUnits } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

function requireEnv(name) {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`Missing env var: ${name}`)
  return v.trim()
}

function resolveAddress() {
  const addr = process.env.ADDRESS?.trim()
  if (addr) return addr
  const pk = process.env.EVM_PRIVATE_KEY?.trim()
  if (pk) return privateKeyToAccount(pk).address
  throw new Error('Provide ADDRESS=0x... or EVM_PRIVATE_KEY=0x...')
}

const CHAIN = (process.env.CHAIN || 'base').trim().toLowerCase()
const RPC_URL = (process.env.RPC_URL || (CHAIN === 'base' ? 'https://mainnet.base.org' : 'https://sepolia.base.org')).trim()
const USDC = (process.env.USDC_ADDRESS || (CHAIN === 'base' ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : '0x036CbD53842c5426634e7929541eC2318f3dCF7e')).trim()
const DECIMALS = Number(process.env.DECIMALS || '6')
const address = resolveAddress()

const client = createPublicClient({
  chain: CHAIN === 'base' ? base : baseSepolia,
  transport: http(RPC_URL),
})

const balance = await client.readContract({
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
  args: [address],
})

console.log(`address=${address}`)
console.log(`usdc=${USDC}`)
console.log(`raw=${balance.toString()}`)
console.log(`formatted=${formatUnits(balance, DECIMALS)} USDC`)
