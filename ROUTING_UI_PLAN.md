# 라우팅 애니메이션 개편 기획서 (Route Explorer UI Enhancement)

**작성일**: 2026-02-24
**대상 컴포넌트**: `apps/live/src/components/RouteGraph.tsx`
**목적**: AI 라우터 특유의 연산 및 최적화(Optimization) 과정과 안전성(Guardian) 철학을 시각화하여, 데모 사이트 데모 시 직관적이고 고급스러운(Premium) 느낌을 전달

---

## 1. As-Is (현재 상태)
- 출발지(Source) -> 브릿지 코인(Bridge) -> 도착지(Dest)로 정해진 단 1개의 '최적 경로'만 선(Path)으로 그려짐.
- 단순히 직선(Bezier Curve)이 오른쪽으로 스윽 그어지고 끝나는 단조로운 연출(Dash Animation).
- 시스템이 최적 경로를 찾아내기 위해 수많은 선택지를 연산했다는 "과정"의 느낌이 부족함.

## 2. To-Be (수정 방향성)

### **핵심 컨셉: 다중 경로 스캔(Scan) & 입자 흐름(Data Pulse)**

### (1) 최적화 검색 스캔 (Optimization Scan)
"Find Route" 버튼을 눌렀을 때, 에이전트가 단 1개의 길만 아는 것이 아니라 여러 개의 대안 경로를 모두 평가한다는 것을 보여줍니다.
- **애니메이션 시작 직후**: 출발지에서 **모든 브릿지 코인 후보 군(Alternatives)**으로 반투명한 스캔 라인이 동시다발적으로 방사형(방채형)으로 뻗어나갑니다.
- **경로 탈락 (Fade Out)**: 연산 결과 최적 경로가 아닌 선들은 1초 뒤 스르륵 사라집니다(마치 AI 가지치기 연산처럼).
- **최적 경로 등장 (Glow In)**: 승리한 '최적 브릿지 경로' 단 하나만 밝은 네온 그린/시안 그라데이션 컬러로 굵고 밝게 고정됩니다.

### (2) 데이터 입자 흐름 (Data River/Pulse Flow)
고르지 않고 불투명한 암호화폐 시장을 넘어 안전한 터널을 뚫었다는 느낌을 줍니다.
- 고정된 최적 선상(Path) 위로, 작은 둥근 **빛 입자(Particle)들이 출발지에서 도착지로 끊임없이 맥동(Pulse)**하며 흘러가는 이펙트를 추가합니다.
- 단순한 점선(Dashed) 기법이 아니라, CSS `@keyframes strok-dashoffset`과 빛나는 그림자(Filter DropShadow)를 혼합해 심미적인 완성도를 높입니다.

### (3) 가디언 검증 상태 시각화 (Guardian Verification)
단순한 라우팅을 넘어 CrossFin의 핵심인 '안전과 정책(Guardian)'을 시각적으로 어필합니다.
- 최종 선택된 브릿지 코인(Node) 중앙점 주변에, 애니메이션이 도착할 때 쯤 초록색 방패 아이콘(또는 빛무리)과 함께 작게 **"GUARDIAN VERIFIED"** (또는 V 마크) 텍스트가 찰나에 페이드인 되는 연출을 삽입합니다.

---

## 3. 구조적 변경점 및 안전성 여부
- **전역 영향도 0%**: 모든 시각 디자인(SVG Elements) 및 CSS Keyframes 수정은 해당 `.tsx` 파일에 `<style>`과 JSX 블럭 형태로 캡슐화되어 반영되므로 사이트 내 다른 컴포넌트(Analytics 패널 등)에 부작용을 일으키지 않습니다.
- **기존 데이터 모델 재활용**: API에서 이미 던져주고 있는 `alternatives` 속성(대체 경로 정보)을 활용해서, 스캔 후 탈락하는 라인들을 그릴 예정이기 때문에 백엔드 변경도 일절 불필요합니다.

## 4. 상세 구현 리스트 (Action Item)
1. **CSS 주입 (`CSS` 변수 블록 내)**
   - `rgScanPulse`: 다중 경로를 훑고 사라지는 애니메이션 정의
   - `rgDataFlow`: 입자(데이터 덩어리)가 라인을 따라 영원히 유영하는 애니메이션
   - `rgGuardianPopup`: 코인 노드가 선택되었을 때 방패/마이크로 텍스트가 뜨는 애니메이션
2. **SVG Element 추가 (`renderEdge`)**
   - 비최적(non-optimal) 라인에 `rgScanPulse` 클라스를 주입. 
   - 최적(optimal) 라인에 `<path strokeDasharray...>`를 겹겹이 쌓아 맥동하는 입자 효과를 구현.
3. **SVG Node 추가 (`renderNode`)**
   - `node.type === 'coin'` 이며 `isOnPath`인 경우, 코인 이름 밑에 초록색의 초소형 `[ VERIFIED ]` 텍스트 레이어 추가.
