import { Hono } from 'hono'
import { CROSSFIN_DISCLAIMER } from '../constants'
import type { Env } from '../types'

const legal = new Hono<Env>()

legal.get('/api/legal/terms', (c) => {
  return c.json({
    title: 'CrossFin Terms of Service / 이용약관',
    effectiveDate: '2026-02-22',
    version: '1.0',
    language: 'en/ko',
    sections: [
      {
        heading: '1. Service Description / 서비스 설명',
        content: 'CrossFin is an API data service that provides real-time market data, routing analysis, and arbitrage signals for informational purposes. CrossFin is NOT a broker, exchange, financial advisor, or registered investment advisor. CrossFin does not execute trades, hold user funds, or provide custody services. | CrossFin은 실시간 시장 데이터, 라우팅 분석, 아비트리지 신호를 정보 제공 목적으로 제공하는 API 데이터 서비스입니다. CrossFin은 브로커, 거래소, 금융 자문사, 또는 등록된 투자자문업자가 아닙니다. CrossFin은 거래를 실행하거나, 사용자 자금을 보관하거나, 수탁 서비스를 제공하지 않습니다.',
      },
      {
        heading: '2. Eligibility / 이용 자격',
        content: 'You must be at least 18 years of age to use this service. Use of this service is prohibited in jurisdictions subject to sanctions by the United States, European Union, United Nations, or Republic of Korea, including but not limited to North Korea, Iran, Russia, Syria, and Cuba. By using this service, you represent and warrant that you meet these eligibility requirements. | 본 서비스를 이용하려면 만 18세 이상이어야 합니다. 미국, 유럽연합, 유엔, 대한민국의 제재 대상 국가(북한, 이란, 러시아, 시리아, 쿠바 등 포함)에서의 서비스 이용은 금지됩니다. 서비스를 이용함으로써 귀하는 이러한 자격 요건을 충족함을 진술하고 보증합니다.',
      },
      {
        heading: '3. Account and Access / 계정 및 접근',
        content: 'CrossFin does not maintain personal user accounts. Access to paid endpoints is granted via x402 protocol using EVM wallet addresses on Base mainnet. Your wallet address serves as your identity. You are solely responsible for the security of your private keys. CrossFin has no ability to recover lost keys or reverse transactions. | CrossFin은 개인 사용자 계정을 유지하지 않습니다. 유료 엔드포인트 접근은 Base 메인넷의 EVM 지갑 주소를 사용하는 x402 프로토콜을 통해 부여됩니다. 귀하의 지갑 주소가 귀하의 신원으로 사용됩니다. 귀하는 개인 키의 보안에 대해 전적으로 책임을 집니다. CrossFin은 분실된 키를 복구하거나 거래를 되돌릴 능력이 없습니다.',
      },
      {
        heading: '4. Acceptable Use / 허용 사용',
        content: 'You may use CrossFin API data for personal analysis, research, and building applications. You may not redistribute, resell, or sublicense CrossFin data to third parties without explicit written permission. You may not use the service to manipulate markets, engage in wash trading, or violate any applicable laws. Automated access must respect rate limits. | CrossFin API 데이터를 개인 분석, 연구, 애플리케이션 구축에 사용할 수 있습니다. 명시적인 서면 허가 없이 CrossFin 데이터를 제3자에게 재배포, 재판매, 또는 재라이선스할 수 없습니다. 시장 조작, 가장 거래, 또는 관련 법률 위반에 서비스를 사용할 수 없습니다. 자동화된 접근은 속도 제한을 준수해야 합니다.',
      },
      {
        heading: '5. Payment / 결제',
        content: 'Paid endpoints require USDC payment on Base mainnet via the x402 protocol. Payments are processed per API call and are non-refundable once the data response is delivered. Subscription services, if offered, are billed via Toss Payments and are subject to separate subscription terms. All prices are denominated in USD. | 유료 엔드포인트는 x402 프로토콜을 통해 Base 메인넷에서 USDC 결제가 필요합니다. 결제는 API 호출당 처리되며, 데이터 응답이 전달된 후에는 환불되지 않습니다. 구독 서비스는 토스페이먼츠를 통해 청구되며 별도의 구독 약관이 적용됩니다. 모든 가격은 USD로 표시됩니다.',
      },
      {
        heading: '6. Intellectual Property / 지식재산권',
        content: 'CrossFin owns all rights to the API infrastructure, routing algorithms, analysis methodologies, and service architecture. Third-party market data (exchange prices, FX rates, stock data) remains the property of the respective data providers. You may not reverse engineer, decompile, or attempt to extract CrossFin\'s proprietary algorithms. | CrossFin은 API 인프라, 라우팅 알고리즘, 분석 방법론, 서비스 아키텍처에 대한 모든 권리를 소유합니다. 제3자 시장 데이터(거래소 가격, 환율, 주식 데이터)는 각 데이터 제공업체의 재산으로 남습니다. CrossFin의 독점 알고리즘을 역공학, 디컴파일, 또는 추출하려는 시도를 할 수 없습니다.',
      },
      {
        heading: '7. Limitation of Liability / 책임 제한',
        content: 'TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, CROSSFIN\'S TOTAL LIABILITY FOR ANY CLAIM ARISING FROM OR RELATED TO THESE TERMS OR YOUR USE OF THE SERVICE SHALL NOT EXCEED THE AMOUNT PAID BY YOU FOR THE SPECIFIC API CALL THAT GAVE RISE TO THE CLAIM. CROSSFIN SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES. | 관련 법률이 허용하는 최대 범위 내에서, 본 약관 또는 서비스 이용과 관련하여 발생하는 모든 청구에 대한 CrossFin의 총 책임은 해당 청구를 발생시킨 특정 API 호출에 대해 귀하가 지불한 금액을 초과하지 않습니다. CrossFin은 간접적, 부수적, 특별, 결과적, 또는 징벌적 손해에 대해 책임을 지지 않습니다.',
      },
      {
        heading: '8. No Warranties / 보증 없음',
        content: 'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND. CROSSFIN DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR THAT DATA WILL BE ACCURATE, COMPLETE, OR TIMELY. CROSSFIN EXPRESSLY DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. | 서비스는 어떠한 종류의 보증도 없이 "있는 그대로" 및 "이용 가능한 상태로" 제공됩니다. CrossFin은 서비스가 중단 없이, 오류 없이 제공되거나 데이터가 정확하고 완전하며 시의적절할 것임을 보증하지 않습니다. CrossFin은 상품성, 특정 목적 적합성, 비침해에 대한 보증을 포함하여 명시적이든 묵시적이든 모든 보증을 명시적으로 부인합니다.',
      },
      {
        heading: '9. Indemnification / 면책',
        content: 'You agree to indemnify, defend, and hold harmless CrossFin and its operators from and against any claims, liabilities, damages, losses, and expenses arising from your use of the service, your violation of these terms, or your violation of any applicable law or third-party rights. | 귀하는 서비스 이용, 본 약관 위반, 또는 관련 법률이나 제3자 권리 위반으로 인해 발생하는 모든 청구, 책임, 손해, 손실, 비용으로부터 CrossFin 및 그 운영자를 면책, 방어, 보호하는 데 동의합니다.',
      },
      {
        heading: '10. Governing Law and Jurisdiction / 준거법 및 관할',
        content: 'These Terms shall be governed by and construed in accordance with the laws of the Republic of Korea. Any dispute arising from or related to these Terms shall be subject to the exclusive jurisdiction of the Seoul Central District Court. | 본 약관은 대한민국 법률에 따라 규율되고 해석됩니다. 본 약관과 관련하여 발생하는 모든 분쟁은 서울중앙지방법원을 전속적 합의관할법원으로 합니다.',
      },
      {
        heading: '11. Modifications / 약관 변경',
        content: 'CrossFin reserves the right to modify these Terms at any time. Material changes will be communicated with at least 30 days notice via the API response headers or the CrossFin website. Continued use of the service after the effective date of changes constitutes acceptance of the modified Terms. | CrossFin은 언제든지 본 약관을 수정할 권리를 보유합니다. 중요한 변경 사항은 API 응답 헤더 또는 CrossFin 웹사이트를 통해 최소 30일 전에 공지됩니다. 변경 발효일 이후 서비스를 계속 이용하면 수정된 약관에 동의한 것으로 간주됩니다.',
      },
    ],
  })
})

legal.get('/api/legal/disclaimer', (c) => {
  return c.json({
    title: 'CrossFin Full Disclaimer / 면책 고지',
    effectiveDate: '2026-02-22',
    version: '1.0',
    language: 'en/ko',
    summary: CROSSFIN_DISCLAIMER,
    sections: [
      {
        heading: '1. Informational Purpose Only / 정보 제공 목적',
        content: 'This service is provided for informational purposes only and does not constitute investment advice, financial advice, trading advice, or any form of professional recommendation. CrossFin is not a registered investment advisor. | 본 서비스는 정보 제공 목적으로만 제공되며, 투자 자문, 금융 자문, 거래 자문 또는 어떠한 종류의 전문적 조언에도 해당하지 않습니다. CrossFin은 등록된 투자자문업자가 아닙니다.',
      },
      {
        heading: '2. No Warranties on Data / 데이터 보증 없음',
        content: 'All data, analyses, and information provided through this service are offered on an "AS IS" and "AS AVAILABLE" basis, without warranties of any kind, whether express or implied, including but not limited to warranties of accuracy, completeness, timeliness, merchantability, fitness for a particular purpose, or non-infringement. | 본 서비스를 통해 제공되는 모든 데이터, 분석, 정보는 "있는 그대로(AS IS)" 제공되며, 그 정확성, 완전성, 시의성 또는 신뢰성에 대하여 명시적이든 묵시적이든 어떠한 보증도 하지 않습니다.',
      },
      {
        heading: '3. Third-Party Data Sources / 제3자 데이터 소스',
        content: 'Data is sourced from third-party exchange APIs (Bithumb, Upbit, Coinone, GoPax, Binance, OKX, Bybit, bitFlyer, WazirX), external FX rate services, and external financial data providers. CrossFin assumes no responsibility for the accuracy of such third-party data. Delays, errors, and omissions may occur during data transmission. | 데이터는 제3자 거래소 API(빗썸, 업비트, 코인원, 고팍스, 바이낸스, OKX, 바이비트, bitFlyer, WazirX), 외부 환율 서비스, 외부 금융 데이터 제공업체에서 수집됩니다. CrossFin은 이러한 외부 소스 데이터의 정확성에 대하여 책임을 지지 않습니다. 데이터 전송 과정에서 지연, 오류, 누락이 발생할 수 있습니다.',
      },
      {
        heading: '4. Not a Trading Recommendation / 거래 추천 아님',
        content: 'Information including but not limited to kimchi premium, arbitrage opportunities, routing recommendations, and market analyses is provided as reference only and does not constitute a recommendation to buy, sell, or hold any virtual asset or financial instrument. | 김치프리미엄, 아비트리지 기회, 라우팅 추천, 시장 분석 등의 정보는 참고용이며, 특정 가상자산이나 금융 상품의 매수, 매도, 보유를 권유하거나 추천하는 것이 아닙니다.',
      },
      {
        heading: '5. Estimates May Differ / 추정치 차이 가능',
        content: 'Estimates of slippage, fees, transfer times, and other metrics are based on historical data and current market conditions and may differ materially from actual trading outcomes. Deviations may be particularly significant in low-liquidity markets. Global exchange slippage is estimated at a fixed 0.10% and may not reflect actual orderbook depth. | 슬리피지, 수수료, 전송 시간 등의 추정치는 과거 데이터와 현재 시장 상황에 기반한 추정값이며, 실제 거래 결과와 상이할 수 있습니다. 특히 유동성이 낮은 시장에서는 추정치와 실제 결과 간의 차이가 클 수 있습니다.',
      },
      {
        heading: '6. User Sole Responsibility / 이용자 단독 책임',
        content: 'All investment decisions and trades made based on this service are at the user\'s sole discretion and risk. CrossFin shall not be liable for any direct, indirect, incidental, consequential, or special damages arising from such decisions. | 본 서비스에 기반한 모든 투자 결정 및 거래는 이용자의 독립적인 판단과 책임 하에 이루어지며, CrossFin은 이러한 결정으로 인한 직접적, 간접적, 부수적, 결과적 또는 특별한 손해에 대하여 어떠한 책임도 부담하지 않습니다.',
      },
      {
        heading: '7. No Uptime Guarantee / 가용성 보장 없음',
        content: 'This service does not guarantee uninterrupted operation. Service interruptions or data delays may occur due to maintenance, upgrades, or third-party service outages. CrossFin is not liable for any losses resulting from service unavailability. | 본 서비스는 24시간 무중단 운영을 보장하지 않으며, 유지보수, 업그레이드, 외부 서비스 장애 등으로 인한 서비스 중단이나 데이터 지연이 발생할 수 있습니다. CrossFin은 서비스 불가용으로 인한 손실에 대해 책임을 지지 않습니다.',
      },
      {
        heading: '8. Maximum Liability Cap / 최대 책임 한도',
        content: 'IN NO EVENT SHALL CROSSFIN\'S TOTAL LIABILITY EXCEED THE AMOUNT PAID BY THE USER FOR THE SPECIFIC API CALL THAT GAVE RISE TO THE CLAIM. This service is governed by the laws of the Republic of Korea. Any disputes shall be subject to the exclusive jurisdiction of the Seoul Central District Court. | 어떠한 경우에도 CrossFin의 총 책임은 해당 청구를 발생시킨 특정 API 호출에 대해 사용자가 지불한 금액을 초과하지 않습니다. 본 서비스는 대한민국 법률을 준거법으로 하며, 모든 분쟁은 서울중앙지방법원을 전속적 합의관할법원으로 합니다.',
      },
    ],
  })
})

legal.get('/api/legal/privacy', (c) => {
  return c.json({
    title: 'CrossFin Privacy Policy / 개인정보처리방침',
    effectiveDate: '2026-02-22',
    version: '1.0',
    language: 'en/ko',
    sections: [
      {
        heading: '1. Data Collected / 수집하는 데이터',
        content: 'CrossFin collects: (1) IP addresses in hashed form for abuse prevention, (2) API usage patterns including endpoint, timestamp, and response status, (3) x402 wallet addresses (public blockchain data), (4) Telegram chat IDs for users of the Telegram bot integration. | CrossFin이 수집하는 데이터: (1) 어뷰징 방지를 위한 해시 처리된 IP 주소, (2) 엔드포인트, 타임스탬프, 응답 상태를 포함한 API 사용 패턴, (3) x402 지갑 주소(공개 블록체인 데이터), (4) 텔레그램 봇 통합 사용자의 텔레그램 채팅 ID.',
      },
      {
        heading: '2. Data NOT Collected / 수집하지 않는 데이터',
        content: 'CrossFin does NOT collect: names, email addresses, passwords, bank account information, KYC (Know Your Customer) data, government-issued ID numbers, biometric data, or any personally identifiable information beyond what is listed above. | CrossFin이 수집하지 않는 데이터: 이름, 이메일 주소, 비밀번호, 은행 계좌 정보, KYC(고객 확인) 데이터, 정부 발급 신분증 번호, 생체 인식 데이터, 또는 위에 나열된 것 이외의 개인 식별 정보.',
      },
      {
        heading: '3. Purpose of Data Collection / 데이터 수집 목적',
        content: 'Collected data is used for: (1) service operation and delivery of API responses, (2) abuse prevention and rate limiting, (3) anonymous usage analytics to improve the service, (4) debugging and error resolution. Data is not used for advertising, profiling, or sale to third parties. | 수집된 데이터는 다음 목적으로 사용됩니다: (1) 서비스 운영 및 API 응답 제공, (2) 어뷰징 방지 및 속도 제한, (3) 서비스 개선을 위한 익명 사용 분석, (4) 디버깅 및 오류 해결. 데이터는 광고, 프로파일링, 또는 제3자 판매에 사용되지 않습니다.',
      },
      {
        heading: '4. Data Storage and Retention / 데이터 저장 및 보존',
        content: 'Data is stored in Cloudflare D1 (SQLite), which is encrypted at rest. API usage logs are retained for 90 days, after which they are automatically deleted. Hashed IP addresses are retained for 30 days. Wallet addresses associated with transactions are retained for 1 year for audit purposes. | 데이터는 저장 시 암호화되는 Cloudflare D1(SQLite)에 저장됩니다. API 사용 로그는 90일간 보존된 후 자동으로 삭제됩니다. 해시 처리된 IP 주소는 30일간 보존됩니다. 거래와 관련된 지갑 주소는 감사 목적으로 1년간 보존됩니다.',
      },
      {
        heading: '5. Third-Party Sharing / 제3자 공유',
        content: 'CrossFin does not sell or share your data with third parties for commercial purposes. Data is shared only with: (1) Cloudflare, as the infrastructure provider (subject to Cloudflare\'s privacy policy), (2) Coinbase, as the x402 payment facilitator for transaction verification. Both are bound by their respective privacy policies and applicable law. | CrossFin은 상업적 목적으로 귀하의 데이터를 제3자에게 판매하거나 공유하지 않습니다. 데이터는 다음과만 공유됩니다: (1) 인프라 제공업체인 Cloudflare(Cloudflare 개인정보처리방침 적용), (2) 거래 검증을 위한 x402 결제 촉진자인 Coinbase. 두 업체 모두 각자의 개인정보처리방침과 관련 법률에 구속됩니다.',
      },
      {
        heading: '6. User Rights / 이용자 권리',
        content: 'You have the right to request deletion of your data. To submit a data deletion request, contact hello@crossfin.dev with your wallet address or Telegram chat ID. CrossFin will process deletion requests within 30 days. Note that blockchain transaction data (wallet addresses on Base mainnet) is public and cannot be deleted by CrossFin. | 귀하는 데이터 삭제를 요청할 권리가 있습니다. 데이터 삭제 요청을 제출하려면 지갑 주소 또는 텔레그램 채팅 ID와 함께 hello@crossfin.dev로 연락하십시오. CrossFin은 30일 이내에 삭제 요청을 처리합니다. 블록체인 거래 데이터(Base 메인넷의 지갑 주소)는 공개 데이터이며 CrossFin이 삭제할 수 없습니다.',
      },
      {
        heading: '7. Cookies / 쿠키',
        content: 'CrossFin is an API-only service and does not use cookies, browser storage, or tracking pixels. The CrossFin website (crossfin.dev) may use minimal session storage for UI state only, with no cross-site tracking. | CrossFin은 API 전용 서비스로 쿠키, 브라우저 저장소, 또는 추적 픽셀을 사용하지 않습니다. CrossFin 웹사이트(crossfin.dev)는 UI 상태를 위한 최소한의 세션 저장소만 사용할 수 있으며, 크로스 사이트 추적은 없습니다.',
      },
      {
        heading: '8. Governing Law / 준거법',
        content: 'This Privacy Policy is governed by the Personal Information Protection Act (PIPA, 개인정보보호법) of the Republic of Korea and other applicable Korean privacy laws. For users in the European Economic Area, CrossFin processes data on the basis of legitimate interests (service operation and security). For any privacy inquiries, contact hello@crossfin.dev. | 본 개인정보처리방침은 대한민국 개인정보보호법(PIPA) 및 기타 관련 한국 개인정보 보호 법률에 의해 규율됩니다. 유럽 경제 지역 사용자의 경우, CrossFin은 정당한 이익(서비스 운영 및 보안)을 근거로 데이터를 처리합니다. 개인정보 관련 문의는 hello@crossfin.dev로 연락하십시오.',
      },
    ],
  })
})

export default legal
