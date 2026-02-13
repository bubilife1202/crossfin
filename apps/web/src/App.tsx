import './App.css'
import LedgerDemo from './components/LedgerDemo'
import LiveSignals from './components/LiveSignals'

function App() {
  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">CrossFin</div>
        <nav className="nav">
          <a href="#why">Why</a>
          <a href="#demo">Demo</a>
          <a href="#roadmap">Roadmap</a>
        </nav>
      </header>

      <main className="content">
        <section className="hero">
          <div className="heroBadge">Agent-native finance infrastructure</div>
          <h1>에이전트의 은행</h1>
          <p className="heroSub">
            에이전트가 카카오페이/토스/Stripe/x402 등 플랫폼을 가로질러 돈을
            관리하도록 만드는 금융 인프라.
          </p>

          <div className="heroCtas">
            <a className="button primary" href="#demo">
              데모 보기
            </a>
            <a className="button" href="#roadmap">
              로드맵
            </a>
          </div>

          <div className="heroNote">
            지금은 프로토타입 단계. 이 페이지의 데모는 로컬 브라우저에만
            저장된다.
          </div>
        </section>

        <section id="why" className="section">
          <h2>왜 필요한가</h2>
          <div className="grid">
            <article className="card">
              <h3>고객은 사람 → 에이전트</h3>
              <p>
                에이전트는 API를 호출하고, 서비스를 구매하고, 다른 에이전트를
                고용하고, 돈을 번다.
              </p>
            </article>
            <article className="card">
              <h3>플랫폼 성벽을 넘는다</h3>
              <p>
                결제는 플랫폼별로 파편화되어 있다. 에이전트에게는 최선의
                선택만 있다.
              </p>
            </article>
            <article className="card">
              <h3>아시아가 더 어렵고, 더 큼</h3>
              <p>
                결제 레일이 더 많고 더 복잡하다. 그래서 "다 연결해주는 놈"의
                가치가 더 크다.
              </p>
            </article>
          </div>
        </section>

        <section id="demo" className="section">
          <h2>데모</h2>
          <p className="sectionSub">
            Phase 1: 에이전트 가계부 (지갑/송금/예산/거래내역). 로컬 브라우저에만
            저장되는 미니 프로토타입.
          </p>
          <LedgerDemo />

          <div className="demoSpacer" aria-hidden />

          <h3 className="sectionH3">Live (Workers + D1 + x402)</h3>
          <p className="sectionSub">
            실제 Cloudflare Workers API에서 집계되는 공개 통계 + x402 paywall(402)
            상태를 보여준다.
          </p>
          <LiveSignals />
        </section>

        <section id="roadmap" className="section">
          <h2>로드맵</h2>
          <div className="grid">
            <article className="card">
              <h3>Phase 1</h3>
              <p>에이전트 가계부: 지갑/송금/예산/리포트 + 대시보드</p>
            </article>
            <article className="card">
              <h3>Phase 2</h3>
              <p>아시아/글로벌 레일 연동 + 멀티커런시 + 스마트 라우팅</p>
            </article>
            <article className="card">
              <h3>Phase 3+</h3>
              <p>신용/평판/분쟁 해결을 포함한 에이전트 금융 시스템</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footerInner">
          <span className="footerBrand">CrossFin</span>
          <span className="footerMeta">Prototype · {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  )
}

export default App
