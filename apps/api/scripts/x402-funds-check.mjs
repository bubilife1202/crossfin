import { createPublicClient, http, formatEther, formatUnits } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

function resolveAddress() {
  const addr = process.env.ADDRESS?.trim()
  if (addr) return addr
  const pk = process.env.EVM_PRIVATE_KEY?.trim()
  if (pk) return privateKeyToAccount(pk).address
  throw new Error('Provide ADDRESS=0x... or EVM_PRIVATE_KEY=0x...')
}

const RPC_URL = (process.env.RPC_URL || 'https://sepolia.base.org').trim()
const USDC = (process.env.USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e').trim()
const USDC_DECIMALS = Number(process.env.USDC_DECIMALS || '6')
const address = resolveAddress()

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
})

const [eth, usdc] = await Promise.all([
  client.getBalance({ address }),
  client.readContract({
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
  }),
])

console.log(`address=${address}`)
console.log(`eth=${formatEther(eth)} ETH`)
console.log(`usdc=${formatUnits(usdc, USDC_DECIMALS)} USDC`)
