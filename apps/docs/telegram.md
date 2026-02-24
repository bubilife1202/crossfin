# Telegram Bot

CrossFin AI agent on Telegram. Korean/Asia crypto market data, routing, and route spread signals — all from a chat window.

## Open the Bot

[t.me/crossfinn_bot](https://t.me/crossfinn_bot) — tap to start chatting.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/route <from> <to> <amount>` | Find the cheapest transfer path across 14 exchanges |
| `/price <coin>` | Live Bithumb KRW vs Binance USD prices |
| `/spread [coin]` | Route spread demo (top 3 pairs, Korea vs global) |
| `/fees [coin]` | Trading + withdrawal fee comparison |
| `/status` | Exchange network health (14 exchanges) |
| `/help` | List all commands |

## Natural Language

No need to memorize commands. Ask in plain Korean or English:

> 빗썸에서 바이낸스로 500만원 보내는 가장 싼 방법 알려줘

> 지금 한국-글로벌 스프레드 얼마야?

> XRP 거래소별 가격 비교해줘

> 업비트 출금 수수료가 얼마야?

The bot understands context and maintains conversation history (last 10 messages).

## Examples

```
/route bithumb:KRW binance:USDC 5000000
/price XRP
/spread BTC
/fees SOL
/status
```

## How It Works

- Powered by GLM-5 with tool calling — reads your message and decides which CrossFin API to call
- Multi-turn memory — remembers your last 10 messages per chat
- Read-only — finds routes and shows data but never executes trades
- Data from 14 exchanges: Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, bitbank, Indodax, Bitkub, Binance, OKX, Bybit, KuCoin, Coinbase

## Integration Endpoint

- Telegram webhook endpoint: `POST /api/telegram/webhook`
- Open beta: all connected premium endpoints are temporarily free. x402 payment enforcement is currently disabled and will be re-enabled later.

## Limitations

- Route finding is read-only. No actual trades are executed.
- Prices are real-time snapshots, not guaranteed quotes.
- CrossFin topics only — the bot won't answer unrelated questions.
