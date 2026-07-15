# 점프를 머리 기준으로 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 점프 판정을 발목에서 머리(눈)로 옮겨 슬라이드와 같은 축을 쓰게 하고, 임계를 실측으로 확정한다.

**Architecture:** 점프를 눈으로 옮기면 `jumpAmount` 와 `slideAmount` 가 같은 값의 부호만 다른 것이 되므로, `headRise` 하나로 합친다. 발목 경로 전체가 죽은 코드가 되어 사라지고, `!sliding` 가드는 도달 불가능해져 함께 사라진다. 임계는 추측이 두 번 빗나갔으므로 디버그 패널에 봉우리 기록(peak-hold)을 넣어 실측으로 확정한다.

**Tech Stack:** 바닐라 JS (ESM), Canvas 2D, 브라우저 셀프 테스트(`?test=1`). 새 의존성 없다.

**설계 문서:** `docs/superpowers/specs/2026-07-15-head-based-jump-design.md`

---

## Global Constraints

- 수정 대상은 **`game/templates/index.html` 단일 파일뿐이다.** 별도 `.js` / `.css` 로 쪼개지 않는다. 이것은 기존 프로젝트 제약이다.
- MediaPipe 의 x, y 는 0~1 정규화이고 **y 는 아래로 갈수록 커진다.** 위로 올라감 = y 감소. **부호 반전이 이 코드에서 가장 흔한 버그다.** 변수명에 방향을 명시한다 (`headRise` = 머리가 뜨면 양수).
- 한국어 문장은 마침표로 끝낸다. 콜론으로 끝내지 않는다.
- 기존 코드 스타일을 따른다. 주석은 "왜" 를 적고 "무엇" 은 적지 않는다.
- 셀프 테스트의 `TEST_CFG` 는 `jumpThreshold: 0.2, slideThreshold: 0.5, slideRelease: 0.7` 로 **못박힌 채 유지한다.** 합성 포즈는 임계와의 관계로 의미가 정해지므로 실측 튜닝(`DEFAULT_CFG`)과 분리된다. 이것은 기존 결정이다.
- 이 작업은 브랜치 `tune/pose-thresholds` 에서 진행한다. 작업 시작 시점에 `context-notes.md` 와 `index.html` 에 **커밋되지 않은 변경이 있다** (`jumpThreshold` 를 0.1 → 0.2 로 되돌린 것과 그 노트). Task 1 이 이 값을 덮어쓰므로 따로 되돌리지 않고 함께 커밋한다.

## 좌표계와 판정 규약

```
headRise = (baseline.eyeY - eye.y) / torsoLen     // 머리가 뜨면 양수, 숙이면 음수
점프     = headRise >  jumpThreshold              // 위로
슬라이드 = headRise < -slideThreshold             // 아래로 (해제는 -slideThreshold * slideRelease)
```

두 판정이 한 축의 양끝이라 **동시에 참일 수 없다.** 임계가 모두 양수인 한 구조적으로 그렇다. 이것이 `!sliding` 가드를 지우는 근거다.

## 개발용 셀프 테스트 하네스 (전 태스크 공통)

셀프 테스트는 브라우저 `?test=1` 로 도는데, TDD 루프를 돌리기엔 느리다. `index.html` 의 순수 로직 구간만 잘라 node 로 돌리는 하네스를 **스크래치패드에** 둔다. **저장소에 커밋하지 않는다.** 최종 검증은 반드시 실제 브라우저로 한다.

`$SCRATCH/harness.mjs` 로 저장한다 (`$SCRATCH` = 세션 스크래치패드 디렉터리).

```javascript
// index.html 의 순수 로직 구간만 잘라 node 에서 셀프 테스트를 돌리는 개발용 하네스
import { readFileSync } from 'node:fs';
const SRC = '/Users/munhokang/82107/weniv_project/game/templates/index.html';
const html = readFileSync(SRC, 'utf8');
const start = html.indexOf('    const LM = {');
const endMark = '      return results;\n    }';
const end = html.indexOf(endMark);
if (start < 0 || end < 0) throw new Error(`구간을 못 찾았다 start=${start} end=${end}`);
const code = html.slice(start, end + endMark.length);
const mod = await import('data:text/javascript,' + encodeURIComponent(code + '\nexport { runSelfTests };'));
const results = mod.runSelfTests();
for (const r of results) console.log(r.ok ? `  ok   ${r.name}` : `  FAIL ${r.name}\n       ${r.msg}`);
console.log(`\n${results.filter(r => r.ok).length} / ${results.length} 통과`);
```

실행은 `node $SCRATCH/harness.mjs` 다. **작업 시작 전 이 하네스가 `10 / 10 통과` 를 내는 것을 확인했다.** 이것이 기준선이다.

하네스는 `const LM = {` 부터 `return results;\n    }` 까지를 잘라내므로, 그 두 표식을 건드리면 하네스가 깨진다. 표식은 유지한다.

## File Structure

```
game/templates/index.html          # 유일한 수정 대상
├─ CSS  #debug .bad / .good        # 38~39행 — 발목 vis 행 전용이라 함께 삭제
├─ LM                              # 113~118행 — ANK_L/R 삭제
├─ DEFAULT_CFG                     # 120~136행 — jumpThreshold 0.08, visibilityMin 삭제
├─ poseMetrics                     # 147~154행 — ankle 삭제
├─ createInputMapper               # 156~275행 — headRise 통일, 봉우리, 발목 제거
├─ makePose                        # 277~297행 — ankleY/ankleVisibility 인자 삭제
├─ runSelfTests                    # 299~473행 — 점프 테스트 3종 갱신, 2종 삭제
├─ TUNABLES                        # 816~822행 — visibilityMin 삭제, jump min 0.02
├─ mountDebugPanel                 # 824~873행 — 행 교체, vis 갱신 삭제
└─ createPreviewOverlay.draw       # 930~950행 — 점프선 기준을 baselineEyeY 로

docs/superpowers/plans/2026-07-15-head-based-jump.md   # 이 문서
checklist.md                        # 태스크 추적 (Task 3 에서 갱신)
context-notes.md                    # 결정 기록 (Task 1·3 에서 갱신)
```

---

### Task 1: 판정축을 머리로 통일하고 발목을 제거한다

한 태스크로 묶는 이유가 있다. `InputMapper` 만 고치면 디버그 패널과 오버레이가 사라진 `debug.ankleVisibility` / `debug.baselineAnkleY` 를 읽어 **페이지가 런타임에 죽는다.** 소비처까지 함께 고쳐야 동작하는 소프트웨어가 남는다.

**Files:**
- Modify: `game/templates/index.html` (CSS 38-39, LM 113-118, DEFAULT_CFG 120-136, poseMetrics 147-154, createInputMapper 156-275, makePose 277-297, runSelfTests 299-473, TUNABLES 816-822, mountDebugPanel 824-873, overlay draw 930-950)
- Modify: `context-notes.md`
- Test: `game/templates/index.html` 안의 `runSelfTests` (브라우저 `?test=1`, 개발 중엔 node 하네스)

**Interfaces:**
- Produces: `debug` 객체가 `{ headRise, laneX, baselineEyeY, torsoLen }` 를 내보낸다. `jumpAmount` / `slideAmount` / `ankleVisibility` / `baselineAnkleY` 는 **사라진다.** `peakHeadRise` 는 이 태스크가 아니라 Task 2 가 추가한다 — 여기서 넣지 않는다.
- Produces: `mapper.update(lm, nowMs)` 의 반환 계약 `{ lane, jump, slide, warning }` 은 **바뀌지 않는다.** Game 과 키보드 모드는 손대지 않는다.

- [ ] **Step 1: 기준선을 확인한다**

Run: `node $SCRATCH/harness.mjs`
Expected: `10 / 10 통과`

- [ ] **Step 2: 셀프 테스트를 머리 기준으로 먼저 고친다 (실패하는 테스트)**

`makePose` (277-297행) 에서 발목 인자를 걷어낸다.

```javascript
    function makePose({
      hipX = 0.5,
      eyeY = 0.10,
      shoulderY = 0.30,
      hipY = 0.55,
      visibility = 1.0,
    } = {}) {
      const lm = Array.from({ length: 33 }, () => ({ x: hipX, y: 0.5, z: 0, visibility }));
      lm[LM.EYE_L] = { x: hipX - 0.02, y: eyeY, z: 0, visibility };
      lm[LM.EYE_R] = { x: hipX + 0.02, y: eyeY, z: 0, visibility };
      lm[LM.SHO_L] = { x: hipX - 0.08, y: shoulderY, z: 0, visibility };
      lm[LM.SHO_R] = { x: hipX + 0.08, y: shoulderY, z: 0, visibility };
      lm[LM.HIP_L] = { x: hipX - 0.05, y: hipY, z: 0, visibility };
      lm[LM.HIP_R] = { x: hipX + 0.05, y: hipY, z: 0, visibility };
      return lm;
    }
```

`점프 시퀀스에서 jump가 정확히 1회 발화한다` (336-348행) 를 갈아끼운다. 눈 기준선 0.10, 몸통 0.25 이므로 임계 0.2 는 `0.2 * 0.25 = 0.05` 상승, 즉 `eyeY < 0.05` 가 점프다.

```javascript
      check('점프 시퀀스에서 jump가 정확히 1회 발화한다', () => {
        // 눈 기준선 0.10, 몸통 0.25. 임계 0.2 → 0.05 위로 뜨면 발화한다
        const m = calibrated();
        const seq = [
          stand(), stand(), stand(),
          makePose({ eyeY: 0.06 }),   // 0.16 몸통 — 아직 아니다
          makePose({ eyeY: 0.03 }),   // 0.28 몸통 — 여기서 발화
          makePose({ eyeY: 0.04 }),   // 0.24 몸통 — 여전히 넘지만 새 엣지가 아니다
          stand(), stand(), stand(),
        ];
        const r = feed(m, seq);
        assert(r.jumps === 1, `jump ${r.jumps}회 발화 (기대 1)`);
      });
```

`숙이고 있는 동안에는 점프가 발화하지 않는다` (404-416행) 를 **통째로 삭제한다.** 이 테스트는 `eyeY: 0.26`(숙임) 과 `ankleY: 0.83`(발목 뜸) 을 동시에 만드는데, 랜드마크가 하나가 되면 만들 수 없는 조합이다. `jumps === 1` 을 단언하고 그 1 회가 마지막 "몸을 세운 뒤 발목을 든" 프레임에서 나오므로, 남기면 그 프레임이 서 있는 것과 구별되지 않아 실패한다. 대체 테스트는 만들지 않는다 — 이 불변식은 슬라이드 유지 테스트의 `assert(r.jumps === 0)` 이 이미 못박고 있다.

`불응기 안의 두 번째 점프는 무시된다` (418-424행) 의 펄스를 바꾼다.

```javascript
      check('불응기 안의 두 번째 점프는 무시된다', () => {
        const m = calibrated();
        const pulse = [makePose({ eyeY: 0.03 }), stand()];
        // 약 130ms 안에 두 번. 불응기 900ms 이므로 1회만 나와야 한다
        const r = feed(m, [stand(), ...pulse, ...pulse]);
        assert(r.jumps === 1, `jump ${r.jumps}회 발화 (기대 1)`);
      });
```

`앞뒤로 움직여 스케일이 변해도 판정이 유지된다` (450-458행) 를 바꾼다. `ankleY: 0.70` 인자는 사라진다.

```javascript
      check('앞뒤로 움직여 스케일이 변해도 판정이 유지된다', () => {
        // 멀리 선 사람 — 몸통 길이가 절반(0.125)이다. 같은 비율의 점프는 여전히 감지돼야 한다
        const far = (o = {}) =>
          makePose({ shoulderY: 0.40, hipY: 0.525, eyeY: 0.35, ...o });
        const m = calibrated(far);
        // 0.35 → 0.32 는 0.03/0.125 = 0.24 몸통. 가까이 있을 때와 같은 비율이다
        const r = feed(m, [far(), far({ eyeY: 0.32 }), far()]);
        assert(r.jumps === 1, `먼 거리에서 jump ${r.jumps}회 발화 (기대 1)`);
      });
```

`발목 visibility가 낮으면 점프가 발화하지 않는다` (460-470행) 를 **통째로 삭제한다.** 게이트 자체가 사라진다.

슬라이드 테스트 3종(유지·히스테리시스·포즈 유실)과 레인 테스트 2종은 **손대지 않는다.** 이미 `eyeY` / `hipX` 만 쓴다.

- [ ] **Step 3: 테스트가 실패하는 것을 확인한다**

Run: `node $SCRATCH/harness.mjs`
Expected: `8 / 8` 이 아니라 **실패가 나온다.** 구현이 아직 발목을 읽으므로 `점프 시퀀스`, `불응기`, `앞뒤로 움직여` 3 종이 `jump 0회 발화 (기대 1)` 로 FAIL 한다. 슬라이드·레인 5 종은 통과한다.

실패 메시지가 `jump 0회 발화 (기대 1)` 가 아니라 `LM.ANK_L is not defined` 류라면 Step 2 를 잘못 적용한 것이다. 멈추고 확인한다.

- [ ] **Step 4: LM 과 DEFAULT_CFG 에서 발목을 걷어낸다**

`LM` (113-118행).

```javascript
    const LM = {
      EYE_L: 2, EYE_R: 5,
      SHO_L: 11, SHO_R: 12,
      HIP_L: 23, HIP_R: 24,
    };
```

`DEFAULT_CFG` (120-136행). `jumpThreshold` 를 잠정값 0.08 로 내리고 `visibilityMin` 을 지운다. 나머지 값과 주석은 그대로 둔다.

```javascript
    const DEFAULT_CFG = {
      // 몸통 길이 대비. 잠정값이고 아직 미검증이다 — 실측으로 확정해야 한다.
      // 머리는 몸이 뜬 만큼만 올라가고 발목은 거기에 무릎 접은 양이 더해지므로
      // 항상 머리 상승량 ≤ 발목 상승량 이다. 발목 실측 봉우리가 0.13 이었으니
      // 머리 봉우리는 그 이하다. 디버그 패널의 봉우리를 읽어 그 값의 75~80% 로 잡는다
      jumpThreshold: 0.08,
      slideThreshold: 0.5,    // 몸통 길이 대비. 이만큼 숙이면 슬라이드가 걸린다
      // 슬라이드를 푸는 문턱. 거는 문턱보다 낮게 둬 경계에서 떠는 것을 막는다.
      // 이 히스테리시스가 없으면 문턱 근처에서 한 프레임 떨어질 때 마침 가로보가
      // 지나가면 억울하게 죽는다. 레인이 laneOut/laneIn 을 쓰는 것과 같은 이유다
      slideRelease: 0.7,      // slideThreshold 대비 비율
      baselineAlpha: 0.02,    // 기준선 추종 EMA
      laneAlpha: 0.3,         // 레인 x EMA
      animMs: 600,            // Game의 JUMP_MS와 값을 맞춰야 한다 (아래 "── Game" 섹션)
      refractoryMs: 300,
      laneOutLeft: 0.30,      // 가운데 → 왼쪽
      laneOutRight: 0.70,     // 가운데 → 오른쪽
      laneInLeft: 0.36,       // 왼쪽 → 가운데
      laneInRight: 0.64,      // 오른쪽 → 가운데
    };
```

`poseMetrics` (147-154행).

```javascript
    // y는 아래로 갈수록 커진다. 위로 올라감 = y 감소
    function poseMetrics(lm) {
      const shoulder = midpoint(lm[LM.SHO_L], lm[LM.SHO_R]);
      const hip = midpoint(lm[LM.HIP_L], lm[LM.HIP_R]);
      const eye = midpoint(lm[LM.EYE_L], lm[LM.EYE_R]);
      const torsoLen = Math.abs(shoulder.y - hip.y);
      return { shoulder, hip, eye, torsoLen };
    }
```

- [ ] **Step 5: InputMapper 를 headRise 하나로 통일한다**

상태 선언 (158-166행). `baseline` 이 `{ eyeY }` 만 갖는다.

```javascript
      const cfg = { ...DEFAULT_CFG, ...overrides };
      let baseline = null;          // { eyeY }
      let calibSamples = [];
      let smoothedLaneX = null;
      let lane = 1;
      let lockUntilMs = 0;
      let jumpWasOver = false;
      let sliding = false;          // 엣지가 아니라 유지되는 자세다
      let lastSignal = { lane: 1, jump: false, slide: false, warning: null };
      let debug = { headRise: 0, laneX: 0.5 };
```

캘리브레이션 (168-184행).

```javascript
      function addCalibrationSample(lm) {
        if (!lm) return;
        const m = poseMetrics(lm);
        if (m.torsoLen < 1e-6) return;
        calibSamples.push({ eyeY: m.eye.y });
      }

      function commitCalibration() {
        if (calibSamples.length === 0) return false;
        const n = calibSamples.length;
        baseline = {
          eyeY: calibSamples.reduce((s, c) => s + c.eyeY, 0) / n,
        };
        calibSamples = [];
        return true;
      }
```

판정부 (215-264행) 를 통째로 갈아끼운다. 레인 블록(201-213행)은 **건드리지 않는다.**

```javascript
        // 몸통 길이로 나눠 거리 변화에 무관하게 만든다.
        // 눈 y 에는 EMA 를 걸지 않는다. 빠뜨린 게 아니라 의도적이다 —
        // 점프는 짧고 빠른 순간 신호라 스무딩하면 봉우리가 뭉개져 감지 자체가 안 된다
        const headRise = (baseline.eyeY - m.eye.y) / m.torsoLen;   // 머리가 뜨면 양수

        // 슬라이드는 자세다 — 숙이고 있는 동안 유지되고 몸을 세우면 풀린다.
        // 걸 때는 slideThreshold, 풀 때는 그보다 낮은 문턱을 쓴다
        sliding = sliding
          ? headRise < -cfg.slideThreshold * cfg.slideRelease
          : headRise < -cfg.slideThreshold;
        const slide = sliding;

        // 점프는 탄도다 — 뜬 순간이 전부이므로 상승 엣지에서 한 번만 발화하고
        // 애니메이션+불응기 동안 잠근다.
        // 숙인 채로 뛸 수 없다는 것은 따로 막지 않아도 된다. 점프와 슬라이드가
        // 한 축의 양끝이라 두 조건이 동시에 참일 수가 없다
        const locked = nowMs < lockUntilMs;
        const jumpOver = headRise > cfg.jumpThreshold;
        let jump = false;
        if (!locked && jumpOver && !jumpWasOver) {
          jump = true;
          lockUntilMs = nowMs + cfg.animMs + cfg.refractoryMs;
        }
        jumpWasOver = jumpOver;

        // 기준선 추종 — 판정 중에는 절대 갱신하지 않는다.
        // 이 가드가 없으면 슬라이드 자세가 기준선으로 굳어 슬라이드가 영영 안 먹는다
        const quiet = Math.abs(headRise) < Math.min(cfg.jumpThreshold, cfg.slideThreshold) / 2;
        if (quiet && !locked && !jump && !slide) {
          baseline.eyeY += cfg.baselineAlpha * (m.eye.y - baseline.eyeY);
        }

        // 기준선과 몸통 길이는 프리뷰 오버레이가 임계선을 그리는 데 쓴다.
        // 판정이 매 프레임의 torsoLen 으로 이뤄지므로 오버레이도 같은 값을 써야
        // 화면의 선과 실제 판정 경계가 어긋나지 않는다
        debug = {
          headRise, laneX: smoothedLaneX,
          baselineEyeY: baseline.eyeY,
          torsoLen: m.torsoLen,
        };
        lastSignal = { lane, jump, slide, warning: null };
        return lastSignal;
```

`quiet` 이 `Math.min(...)` 인 것은 기존 두 조건 `|jumpAmount| < jumpThreshold/2 && |slideAmount| < slideThreshold/2` 와 **정확히 같다.** 두 양이 같은 값의 부호만 다르므로 둘 중 좁은 대역이 이긴다.

- [ ] **Step 6: 테스트가 통과하는 것을 확인한다**

Run: `node $SCRATCH/harness.mjs`
Expected: `8 / 8 통과`

실패하면 부호를 먼저 의심한다. `headRise` 는 머리가 **뜨면 양수** 이고 슬라이드는 **음수** 쪽이다.

- [ ] **Step 7: 디버그 패널에서 발목 행을 걷어낸다**

CSS (38-39행) 를 삭제한다. `.bad` / `.good` 은 발목 vis 행에서만 쓰였다.

```
    #debug .bad { color: #ff6b6b; }      ← 삭제
    #debug .good { color: #7ef6a0; }     ← 삭제
```

`TUNABLES` (816-822행). `visibilityMin` 슬라이더를 지우고 `jumpThreshold` 하한을 내린다. 기존 하한 0.05 는 발목 크기를 전제로 잡은 값이라, 머리 봉우리가 0.05 근처로 나오면 확정값 0.04 를 만들 수 없다.

```javascript
    const TUNABLES = [
      { key: 'jumpThreshold', label: '점프 임계', min: 0.02, max: 0.6, step: 0.01 },
      { key: 'slideThreshold', label: '슬라이드 임계', min: 0.1, max: 1.0, step: 0.01 },
      { key: 'baselineAlpha', label: '기준선 EMA', min: 0.0, max: 0.2, step: 0.005 },
      { key: 'laneAlpha', label: '레인 EMA', min: 0.05, max: 1.0, step: 0.05 },
    ];
```

패널 마크업 (829-834행). `점프량` / `슬라이드량` 두 행은 같은 값의 부호만 다르므로 한 행으로 합친다. `발목 vis` 행은 사라진다. `점프 봉우리` 행은 **Task 2 에서** 추가하므로 여기서는 넣지 않는다.

```javascript
        <h3>디버그 (D 키로 토글)</h3>
        <div class="row"><span>머리 높이</span><span id="d-head">-</span></div>
        <div class="row"><span>laneX</span><span id="d-lanex">-</span></div>
        <div class="row"><span>확정 레인</span><span id="d-lane">-</span></div>
        <div class="row"><span>모드</span><span id="d-mode">-</span></div>
```

패널 갱신 (861-871행).

```javascript
        update(debug, lane, mode) {
          if (root.classList.contains('hidden')) return;
          el('#d-head').textContent = debug.headRise.toFixed(3);
          el('#d-lanex').textContent = debug.laneX.toFixed(3);
          el('#d-lane').textContent = lane;
          el('#d-mode').textContent = mode;
        },
```

- [ ] **Step 8: 오버레이 점프선을 눈 기준선에 붙인다**

`draw` (937-943행). 세 선이 모두 `baselineEyeY` 에서 뻗는다. 라벨 겹침 규칙(반대쪽 끝)은 그대로 둔다 — 점프선은 기준선 위, 슬라이드/해제는 아래라 서로 겹치지 않는다.

```javascript
        // 세 선이 모두 눈 기준선에서 뻗는다. 점프는 위로, 슬라이드는 아래로 —
        // 판정이 한 축의 양끝이라는 구조가 화면에 그대로 보인다
        // 머리가 이 선 위로 올라가면 점프한다
        hline(d.baselineEyeY - cfg.jumpThreshold * d.torsoLen, '#7ef6a0', '점프');
        // 눈이 실선 아래로 내려가면 슬라이드가 걸리고, 점선 위로 올라와야 풀린다.
        // 두 선 사이가 히스테리시스 구간이다 — 여기서는 걸려 있든 풀려 있든 유지된다
        hline(d.baselineEyeY + cfg.slideThreshold * d.torsoLen, '#ffd166', '슬라이드');
        hline(d.baselineEyeY + cfg.slideThreshold * cfg.slideRelease * d.torsoLen,
              'rgba(255,209,102,0.5)', '해제', [3, 3], 'right');
```

- [ ] **Step 9: 발목 잔재가 없는지 확인한다**

Run: `grep -n "ankle\|ANK_\|visibilityMin\|jumpAmount\|slideAmount\|d-vis\|\.good\|\.bad" game/templates/index.html`
Expected: **출력 없음.** 무언가 남으면 그 지점을 마저 지운다.

- [ ] **Step 10: 브라우저로 실제 검증한다**

Run: `.venv/bin/python manage.py runserver`

1. `http://localhost:8000/?test=1` → **`8 / 8 통과`** 를 눈으로 확인한다. node 하네스는 DOM 을 안 거치므로 이 확인을 대신하지 못한다.
2. `http://localhost:8000/` → 게임을 켜고 `D` 로 디버그 패널을 연다. 콘솔에 에러가 없어야 한다. `머리 높이` 가 움직이고, 프리뷰에 `점프` 선이 머리 **위** 에, `슬라이드`/`해제` 선이 **아래** 에 그려져야 한다.
3. 캘리브레이션 후 제자리에서 뛰어본다. 점프가 발화하는지 본다. **잠정 임계 0.08 이라 오발화가 있을 수 있다** — 정상이다. Task 3 에서 확정한다.

- [ ] **Step 11: `context-notes.md` 에 결정을 적는다**

파일 끝의 `(여기에 계속 덧붙인다)` **위** 에 덧붙인다. 커밋되지 않은 채 남아 있는 "점프 임계를 0.2 로 되돌렸다" 절은 **지우지 않는다.** 그 절의 결론이 이번에 뒤집혔다는 것을 새 절에서 밝힌다.

```markdown
### 점프를 머리 기준으로 옮기고 판정축을 하나로 합쳤다 (2026-07-15)

사용자 요청은 "점프도 슬라이드처럼 머리 기준으로" 였고, 동기는 "점프가 잘 안 걸림" 이었다.

**랜드마크 교체는 그 증상의 원인이 아니었다.** 점프에서 발목은 몸이 뜬 양 + 무릎 접은
양만큼 올라가고 머리는 몸이 뜬 양만큼만 올라간다. 항상 머리 상승량 ≤ 발목 상승량이다.
발목 실측 봉우리가 0.13 이었으니 머리 봉우리는 그 이하고, 임계 0.2 로는 **머리 기준이
오히려 더 안 걸린다.** 위 "점프 임계를 0.2 로 되돌렸다" 절의 우려가 맞았다 — 0.2 는
봉우리보다 높아 점프가 아예 발화하지 않는 값이었다. 그것이 진짜 원인이었다.

그럼에도 머리로 옮긴 것은 발목이 **양발 중점** 이라 한 발만 들면 절반만 움직이기
때문이다. 실측 0.13 이 비정상적으로 낮았던 유력한 이유고, 머리에는 그 아티팩트가 없다.
머리가 더 정직한 신호다. 대신 임계가 훨씬 낮아야 한다.

**판정축이 하나가 됐다.** jumpAmount 와 slideAmount 가 같은 값의 부호만 다른 것이라
headRise 하나로 합쳤다. 점프는 headRise > jumpThreshold, 슬라이드는 headRise <
-slideThreshold 다.

**딸려 나온 삭제 두 가지.**
- `!sliding` 가드가 도달 불가능해져 지웠다. 슬라이드 중이면 headRise 가 음수고 점프는
  양수를 요구한다. 임계가 모두 양수인 한 동시에 참일 수 없다. 그 테스트(`숙이고 있는
  동안에는 점프가 발화하지 않는다`)도 지웠다 — eyeY 숙임과 ankleY 뜸을 동시에 만드는
  테스트라 랜드마크가 하나가 되면 만들 수 없고, 남기면 절대 실패 못 하는 초록 테스트가 된다.
- 발목 경로 전체가 죽은 코드가 돼 지웠다. visibility 게이트, '발이 화면에 보이지
  않습니다' 경고, 디버그 vis 행과 .good/.bad CSS, visibilityMin 슬라이더가 함께 사라졌다.

**관찰 (고치지 않았다).** 슬라이드는 원래부터 눈에 visibility 게이트가 없다. 머리가 화면
밖이면 MediaPipe 가 추정한 엉뚱한 eye.y 를 그대로 믿는다. 잠재적 결함이지만 이번 요청
범위 밖이고, 게이트를 점프에만 붙이면 슬라이드와 비대칭이 된다. 기록만 남긴다.

**셀프 테스트:** 10 개에서 2 개를 지워 8 개다. TEST_CFG 는 jumpThreshold 0.2 로 못박힌
채라 이 변경에 영향받지 않는다.
```

- [ ] **Step 12: 커밋**

```bash
git add game/templates/index.html context-notes.md
git commit -m "점프 판정을 발목에서 머리로 옮기고 판정축을 하나로 합침

jumpAmount 와 slideAmount 가 같은 값의 부호만 다른 것이라 headRise 하나로
합쳤다. 발목 경로 전체와 도달 불가능해진 !sliding 가드를 함께 제거했다.
임계 0.08 은 잠정값이고 미검증이다."
```

---

### Task 2: 디버그 패널에 점프 봉우리를 기록한다

임계 추측이 두 번 다 빗나간 진짜 이유는 봉우리가 2~3 프레임짜리라 실시간 숫자로는 읽을 수 없다는 것이다. peak-hold 가 그 측정을 가능하게 한다. 이것이 Task 3 의 전제다.

**Files:**
- Modify: `game/templates/index.html` (createInputMapper, mountDebugPanel)
- Test: `game/templates/index.html` 안의 `runSelfTests`

**Interfaces:**
- Consumes: Task 1 의 `headRise`, `debug` 객체.
- Produces: `debug.peakHeadRise` — 마지막 캘리브레이션 이후 관측된 `headRise` 의 최댓값.

- [ ] **Step 1: 봉우리 테스트를 먼저 쓴다 (실패하는 테스트)**

`runSelfTests` 안, `앞뒤로 움직여 스케일이 변해도 판정이 유지된다` 뒤에 넣는다. `getDebug()` 는 이미 노출돼 있다.

```javascript
      check('봉우리는 관측된 최대 상승량을 유지하고 캘리브레이션에서 리셋된다', () => {
        // 봉우리는 2~3 프레임짜리라 실시간 값으로는 읽을 수 없다. 그래서 붙든다
        const m = calibrated();
        feed(m, [stand(), makePose({ eyeY: 0.03 }), stand()]);   // 0.28 몸통
        const peak = m.getDebug().peakHeadRise;
        assert(Math.abs(peak - 0.28) < 1e-6, `봉우리 ${peak} (기대 0.28)`);

        // 더 낮은 점프가 뒤따라도 봉우리는 내려가지 않는다
        feed(m, [makePose({ eyeY: 0.06 }), stand()], 5000);      // 0.16 몸통
        const held = m.getDebug().peakHeadRise;
        assert(Math.abs(held - 0.28) < 1e-6, `봉우리가 ${held} 로 내려갔다 (기대 0.28 유지)`);

        // 기준선이 바뀌면 이전 봉우리는 의미가 없다
        for (let i = 0; i < 30; i++) m.addCalibrationSample(stand());
        m.commitCalibration();
        const reset = m.getDebug().peakHeadRise;
        assert(reset === 0, `캘리브레이션 후 봉우리 ${reset} (기대 0)`);
      });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node $SCRATCH/harness.mjs`
Expected: `8 / 9 통과`. 새 테스트가 `봉우리 undefined (기대 0.28)` 로 FAIL 한다.

- [ ] **Step 3: peak-hold 를 구현한다**

`createInputMapper` 의 상태 선언에 추가한다.

```javascript
      let peakHeadRise = 0;         // 봉우리는 2~3 프레임이라 실시간으로는 못 읽는다. 붙들어서 실측에 쓴다
```

`commitCalibration` 안, `calibSamples = [];` 앞에 리셋을 넣는다.

```javascript
        peakHeadRise = 0;   // 기준선이 바뀌면 이전 봉우리는 의미가 없다
```

`update` 안, `jumpWasOver = jumpOver;` 바로 뒤에 갱신을 넣는다.

```javascript
        if (headRise > peakHeadRise) peakHeadRise = headRise;
```

`debug` 객체에 실어 보낸다.

```javascript
        debug = {
          headRise, peakHeadRise, laneX: smoothedLaneX,
          baselineEyeY: baseline.eyeY,
          torsoLen: m.torsoLen,
        };
```

`update` 가 한 번도 안 돈 상태에서도 패널이 읽으므로 초기값에도 넣는다. Task 1 에서 `let debug = { headRise: 0, laneX: 0.5 };` 였던 줄을 고친다.

```javascript
      let debug = { headRise: 0, peakHeadRise: 0, laneX: 0.5 };
```

`getDebug()` 는 이미 `debug` 를 돌려주므로 손대지 않는다.

- [ ] **Step 4: 통과를 확인한다**

Run: `node $SCRATCH/harness.mjs`
Expected: `9 / 9 통과`

- [ ] **Step 5: 패널에 봉우리 행을 넣는다**

마크업의 `머리 높이` 행 바로 뒤에 넣는다.

```javascript
        <div class="row"><span>머리 높이</span><span id="d-head">-</span></div>
        <div class="row"><span>점프 봉우리</span><span id="d-peak">-</span></div>
```

갱신에 한 줄 넣는다.

```javascript
          el('#d-peak').textContent = debug.peakHeadRise.toFixed(3);
```

- [ ] **Step 6: 브라우저로 확인한다**

Run: `.venv/bin/python manage.py runserver`

1. `http://localhost:8000/?test=1` → `9 / 9 통과`
2. `http://localhost:8000/` → `D` 로 패널을 연다. 캘리브레이션 후 뛰면 `점프 봉우리` 가 올라가고 **내려오지 않아야** 한다. 재캘리브레이션하면 0 으로 돌아가야 한다.

- [ ] **Step 7: 커밋**

```bash
git add game/templates/index.html
git commit -m "디버그 패널에 점프 봉우리(peak-hold) 추가

봉우리가 2~3 프레임짜리라 실시간 값으로는 읽을 수 없었다. 임계 추측이 두 번
빗나간 이유이므로 측정 도구를 먼저 놓는다."
```

---

### Task 3: 실측으로 임계를 확정한다

**이 태스크는 사용자의 몸이 필요하다. 에이전트가 대신할 수 없다.** 카메라 앞에서 실제로 뛰어야 나오는 숫자다.

**Files:**
- Modify: `game/templates/index.html` (`DEFAULT_CFG.jumpThreshold` 한 줄과 그 주석)
- Modify: `context-notes.md`, `checklist.md`

**Interfaces:**
- Consumes: Task 2 의 `debug.peakHeadRise` 와 디버그 패널의 `점프 봉우리` 행.

- [ ] **Step 1: 사용자에게 측정을 요청한다**

`.venv/bin/python manage.py runserver` 를 띄우고 사용자에게 절차를 안내한다.

1. `http://localhost:8000/` 을 열고 캘리브레이션을 한다.
2. `D` 로 디버그 패널을 연다.
3. **두 발로** 평소 게임할 때처럼 3~5 회 점프한다.
4. `점프 봉우리` 값을 읽어 알려준다.

한 발 점프는 안 된다. 발목 실측 0.13 을 오염시킨 것이 그 아티팩트였다고 보고 있고, 머리 기준에서도 자세가 기울면 값이 흔들린다.

- [ ] **Step 2: 웅크림이 슬라이드를 건드리는지 함께 확인한다**

같은 세션에서 물어본다. 점프할 때 `슬라이드` 판정이 깜빡이는가.

뛰기 전 반동으로 머리가 내려가는데 그게 `slideThreshold`(0.5 몸통 ≈ 25cm) 를 넘으면 슬라이드가 잠깐 걸렸다 풀린다. 작은 홉의 반동은 0.2 몸통 정도라 아마 안 걸리지만, 걸리면 **별도 설계가 필요하다.** 이 계획의 범위 밖이므로 발견되면 기록만 하고 사용자에게 알린다.

- [ ] **Step 3: 임계를 확정한다**

봉우리의 **75~80%** 로 잡는다. 봉우리를 P 라 하면 `jumpThreshold = round(P * 0.78, 2)` 근처의 깔끔한 값이다. 여유가 필요한 이유는 매번 같은 높이로 뛸 수 없어서다 — 봉우리에 딱 맞추면 평소 점프의 절반이 안 걸린다.

예를 들어 P 가 0.11 이면 0.08 (마침 잠정값이 맞은 것이다), P 가 0.07 이면 0.05, P 가 0.20 이면 0.15 다.

`DEFAULT_CFG` 의 주석을 **추정에서 실측으로** 바꾼다. 아래의 `<P>` 와 `<확정값>` 을 실제 숫자로 채운다.

```javascript
      // 몸통 길이 대비. 두 발 점프 실측 봉우리 <P> 의 약 78%.
      // 봉우리에 딱 맞추면 매번 같은 높이로 뛸 수 없어 절반이 안 걸린다
      jumpThreshold: <확정값>,
```

`TUNABLES` 의 `jumpThreshold` 하한 0.02 가 확정값보다 크면 더 내린다. 그럴 일은 없을 것이다.

- [ ] **Step 4: 확정값으로 실제로 게임을 해본다**

Run: `.venv/bin/python manage.py runserver`

사용자가 `http://localhost:8000/` 에서 한 판 한다. 점프가 의도대로 걸리고 서 있을 때 오발화가 없어야 한다. 안 맞으면 디버그 패널의 `점프 임계` 슬라이더로 즉석에서 조정하고 (슬라이더는 `cfg` 를 직접 참조한다) 만족하는 값을 `DEFAULT_CFG` 에 박는다.

- [ ] **Step 5: 셀프 테스트가 여전히 통과하는지 확인한다**

Run: `node $SCRATCH/harness.mjs`
Expected: `9 / 9 통과`

`TEST_CFG` 가 `jumpThreshold: 0.2` 로 못박혀 있으므로 `DEFAULT_CFG` 변경은 테스트에 영향이 없어야 한다. 여기서 깨지면 **못박기가 뚫린 것이다** — 원인을 찾는다.

- [ ] **Step 6: `context-notes.md` 와 `checklist.md` 를 갱신한다**

`context-notes.md` 의 `(여기에 계속 덧붙인다)` 위에 덧붙인다. `<P>` 와 `<확정값>` 을 채운다.

```markdown
### 머리 기준 점프 임계를 실측으로 확정했다 (2026-07-15)

두 발 점프 봉우리 **<P>** (몸통 길이 대비). 임계를 그 78% 인 **<확정값>** 으로 박았다.
봉우리에 딱 맞추면 매번 같은 높이로 뛸 수 없어 절반이 안 걸린다.

이제 이 값은 **추측이 아니라 실측이다.** 이전 두 번(0.1, 0.2)은 봉우리를 실시간 숫자로
읽으려다 빗나갔다. 봉우리가 2~3 프레임짜리라 눈으로 못 잡는다. peak-hold 가 그것을 풀었다.

**웅크림/슬라이드 간섭:** <관측 결과를 적는다 — 안 걸렸으면 "관측되지 않았다", 걸렸으면
증상과 함께>.
```

`checklist.md` 의 마지막 줄을 완료로 바꾼다.

```markdown
- [x] 실측 튜닝 — 임계값을 몸으로 조정하고 context-notes.md에 확정값 기록
```

- [ ] **Step 7: 커밋**

```bash
git add game/templates/index.html context-notes.md checklist.md
git commit -m "머리 기준 점프 임계를 실측으로 확정

두 발 점프 봉우리 <P> 의 78%. peak-hold 로 봉우리를 처음 제대로 읽었다."
```

---

## 완료 기준

- `?test=1` 이 브라우저에서 `9 / 9 통과`
- `grep -n "ankle\|ANK_\|visibilityMin\|jumpAmount\|slideAmount" game/templates/index.html` 이 빈 출력
- 카메라 앞에서 점프가 의도대로 걸리고 서 있을 때 오발화가 없다
- `jumpThreshold` 가 실측 근거와 함께 `context-notes.md` 에 기록돼 있다
