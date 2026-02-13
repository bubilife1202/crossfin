import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const pk = generatePrivateKey()
const account = privateKeyToAccount(pk)

console.log(`address=${account.address}`)
console.log(`private_key=${pk}`)
