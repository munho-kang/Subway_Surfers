# 진짜 3D 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canvas 2D 가짜 원근 화면을 Three.js 진짜 3D 장면으로 바꾼다. 게임 규칙은 그대로.

**Architecture:** `createGame` 에서 그리기를 떼어 내고 `view()` 로 상태를 내보낸다. 새 `createRenderer3D` 가
그 값을 받아 Three.js 장면을 그리고, 점수판과 비네트는 위에 얹은 투명 2D 캔버스 `#hud` 에 그린다.
장애물 메시는 `syncMeshes` 로 게임 물체와 1:1 로 짝지어 풀에서 돌려쓴다.

**Tech Stack:** Three.js 0.186.1 (jsDelivr, importmap + 동적 import), UnrealBloomPass, 기존 단일 `public/index.html`

**Spec:** `docs/superpowers/specs/2026-09-27-three-3d-renderer-design.md`

## Global Constraints

- 직접 쓰는 코드는 전부 `public/index.html` 한 파일 안
- Three.js 버전 `0.186.1`, URL `https://cdn.jsdelivr.net/npm/three@0.186.1/...`
- Three.js 는 `boot()` 안에서만 동적 `import()`. `?test=1` 경로는 Three.js 를 부르지 않는다
- 게임 로직(`spawnGroup`, `clears`, `step` 안의 판정·속도·점수)은 한 글자도 바꾸지 않는다
- 렌더 픽셀 비율 상한 1.5, 그림자 맵 없음, 광원 2개
- `?bloom=0` 이면 블룸 없이 그린다
- 주석은 지금 파일처럼 한국어, "왜" 를 적는다
- 작업 브랜치 `feature/3d-renderer`

## Review Focus

1. 게임 중 창 크기를 바꾸면 3D 화면과 점수판이 둘 다 새 크기로 맞아야 한다(늘어나거나 흐려지지 않게)
2. CDN 이나 WebGL 이 막히면 시작 버튼이 막히고 안내 문구가 떠야 하며, `?test=1` 은 그래도 돌아야 한다
3. 몇 분을 달려도 메시가 늘어나기만 하면 안 된다 — 풀이 재사용해야 한다 (Task 1 테스트가 고정)
4. 게임오버 뒤 시작 화면에서는 이전 판 장애물과 러너가 보이면 안 된다 (Task 1 테스트의 "빈 목록" 단언 + Task 3 브라우저 확인)
5. `#canvas` 에 2D 컨텍스트를 한 번이라도 요청하면 WebGL 을 못 얻는다 — `#canvas` 에는 `getContext('2d')` 호출이 남아 있으면 안 된다 (Task 2 grep 확인)

---

## 공통 도구: 셀프 테스트를 노드로 돌리기

브라우저 없이 `?test=1` 테스트를 돌리는 임시 스크립트. 저장소에 넣지 않고 scratchpad 에 둔다.
경로를 `$SP` 라 부른다 (`/private/tmp/claude-501/-Users-munhokang-82107-Subway-Surfers/<세션>/scratchpad`).

`$SP/run-selftests.mjs`:

```js
// index.html 의 모듈 스크립트를 떼어 내 노드에서 runSelfTests() 를 돌린다
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync(process.argv[2], 'utf8');
const open = '<script type="module">';
let src = html.slice(html.indexOf(open) + open.length, html.lastIndexOf('</script>'));
src = src.replace(/if \(new URLSearchParams\(location\.search\)\.get\('test'\) === '1'\) \{[\s\S]*$/,
  'globalThis.__results = runSelfTests();');
const out = new URL('./selftest-body.mjs', import.meta.url);
writeFileSync(out, src);
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
const stubEl = {
  width: 0, height: 0, content: '', textContent: '', disabled: false,
  style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => noop, addEventListener() {}, getBoundingClientRect: () => ({ width: 0, height: 0 }),
};
Object.assign(globalThis, {
  window: globalThis, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
  addEventListener() {}, requestAnimationFrame() {}, matchMedia: () => ({ matches: false }),
  location: { search: '' },
  document: { getElementById: () => stubEl, querySelector: () => stubEl, createElement: () => stubEl,
    body: {}, fonts: { load: () => Promise.resolve() } },
});
await import(out.href);
const r = globalThis.__results;
for (const x of r) console.log(x.ok ? 'PASS' : 'FAIL', x.name, x.msg ?? '');
const bad = r.filter((x) => !x.ok).length;
console.log(`${r.length - bad}/${r.length}`);
process.exit(bad ? 1 : 0);
```

실행: `node $SP/run-selftests.mjs public/index.html`

---

### Task 1: `syncMeshes` — 물체와 메시 짝짓기

**Files:**
- Modify: `public/index.html` — Game 섹션의 `mulberry32` 바로 위에 함수 추가, `runSelfTests()` 의 `return results;` 바로 위에 테스트 추가

**Interfaces:**
- Produces: `syncMeshes(map: Map<object, mesh>, objects: object[], acquire: (kind) => mesh, release: (kind, mesh) => void): void`

- [ ] **Step 1: 셀프 테스트 도구 만들기** — 위 "공통 도구" 를 `$SP/run-selftests.mjs` 로 저장하고 실행해 기존 테스트 20개가 모두 PASS 인지 본다

- [ ] **Step 2: 실패하는 테스트 쓰기** — `runSelfTests()` 의 마지막 `return results;` 바로 위에:

```js
      check('사라진 물체의 메시는 풀로 돌아가고 새 물체가 그것을 다시 쓴다', () => {
        // 몇 분을 달려도 메시 수가 늘기만 하면 안 된다. 동시에 보이는 수만큼만 만들어져야 한다
        const pool = { coin: [], pillar: [] };
        let made = 0;
        const acquire = (kind) => pool[kind].pop() ?? { id: made++, kind };
        const release = (kind, mesh) => pool[kind].push(mesh);
        const map = new Map();
        const a = { kind: 'coin' }, b = { kind: 'coin' }, p = { kind: 'pillar' };

        syncMeshes(map, [a, b, p], acquire, release);
        assert(map.size === 3 && made === 3, `물체 3개에 메시 ${map.size}개, 만든 수 ${made}`);

        syncMeshes(map, [b, p], acquire, release);
        assert(!map.has(a) && pool.coin.length === 1, '사라진 코인의 메시가 풀로 돌아가지 않았다');

        const c = { kind: 'coin' };
        syncMeshes(map, [b, p, c], acquire, release);
        assert(made === 3, `풀에 코인 메시가 있는데 새로 만들었다 (만든 수 ${made})`);
        assert(map.get(c).kind === 'coin', '종류가 다른 풀에서 메시를 꺼냈다');

        // 게임오버 뒤 시작 화면 — 이전 판 메시가 남아 보이면 안 된다
        syncMeshes(map, [], acquire, release);
        assert(map.size === 0 && pool.coin.length === 2 && pool.pillar.length === 1, '빈 목록인데 메시가 남았다');
      });
```

- [ ] **Step 3: 실패 확인** — `node $SP/run-selftests.mjs public/index.html`
  기대: 새 테스트 FAIL (`syncMeshes is not defined`), 나머지 20개 PASS, 종료 코드 1

- [ ] **Step 4: 구현** — `// 결정적 난수.` 주석 바로 위에:

```js
    // 게임 물체와 3D 메시를 1:1 로 짝짓는다. 새 물체는 풀에서 메시를 받고, 사라진 물체의 메시는
    // 풀로 돌아간다. 프레임마다 메시를 새로 만들면 몇 분 뒤 GPU 메모리가 샌다
    function syncMeshes(map, objects, acquire, release) {
      const alive = new Set(objects);
      for (const [o, mesh] of map) {
        if (!alive.has(o)) {
          release(o.kind, mesh);
          map.delete(o);
        }
      }
      for (const o of objects) if (!map.has(o)) map.set(o, acquire(o.kind));
    }

```

- [ ] **Step 5: 통과 확인** — 같은 명령. 기대: `21/21`, 종료 코드 0

- [ ] **Step 6: 커밋**

```bash
git add public/index.html
git commit -m "게임 물체와 3D 메시를 짝지어 돌려쓰는 syncMeshes 추가"
```

---

### Task 2: 그리기를 떼어 내고 3D 무대(바닥·하늘·안개·카메라·블룸) 세우기

이 작업이 끝나면 3D 바닥과 레인 선이 흐르고 점수판이 보인다. 장애물과 러너는 아직 안 보인다(Task 3, 4).

**Files:**
- Modify: `public/index.html` — `<head>` 에 importmap, `<style>` 에 `#hud`, `<body>` 에 `<canvas id="hud">`,
  Game 섹션 전체(현재 약 949–1533행), 부트 섹션의 `resizeCanvas`·`createGame(canvas)`·`loop`

**Interfaces:**
- Consumes: `syncMeshes` (Task 1)
- Produces:
  - `createGame()` → `{ reset(seed, startMs), step(signal, atMs), view(), getState(), getScore() }`
  - `view()` → `{ objects, laneVisual, jumpT: number|null, sliding, distance, speed, coins, score, nowMs }`
  - `createRenderer3D(THREE, addons, canvas)` → `{ render(view, W, H), renderIdle(atMs, W, H) }`
  - 상수 `LANE_W = 2.4`, `RUNNER_H = 1.8`, `JUMP_H = 2.2`, `BLOOM`
  - 렌더러 안의 `scene`, `unitBox`, `unitEdges`, `acquire/release` 자리 (Task 3 이 채운다), `runner` 자리 (Task 4 가 채운다)

- [ ] **Step 1: importmap** — `<head>` 의 `<style>` 바로 위에:

```html
  <!-- 3D 엔진. 모듈 스크립트가 boot() 안에서 필요할 때 부른다 — ?test=1 은 부르지 않는다 -->
  <script type="importmap">
    {
      "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"
      }
    }
  </script>
```

- [ ] **Step 2: 점수판 캔버스** — CSS `#canvas { ... }` 줄 아래에:

```css
    /* 3D 캔버스 위에 얹는 투명 층. 점수판과 비네트만 그린다. 클릭은 아래로 통과시킨다 */
    #hud { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
```

  `<canvas id="canvas"></canvas>` 아래에 `<canvas id="hud"></canvas>`

- [ ] **Step 3: 옛 2D 그리기 코드 삭제** — Game 섹션에서 다음을 지운다:
  `PERSPECTIVE_K`, `LANE_SPREAD`, `HORIZON_RATIO` 상수, `project`, `laneScreenX`, `WORLD_SCALE`, `SKYLINE`,
  `gcache`/`grads`, `drawWorld`, 그리고 `createGame` 안의 `ctx`, `groundShadow`, `drawObject`, `limb`,
  `drawRunner`, `drawCharacter`, `drawHud`, `vignette`, `render`, `renderIdle`.
  `Z_SPAWN`, `Z_CHAR`, `Z_DESPAWN`, 속도·간격·코인 상수, `speedGauge`, `C`, `DISPLAY_FONT`, `mulberry32`,
  `clears`, `spawnGroup` 은 남긴다.

- [ ] **Step 4: `createGame` 을 로직 전용으로** — 시그니처를 `function createGame()` 으로, 반환부를:

```js
      const getScore = () => Math.floor(distance) + coins * COIN_VALUE;

      // 그리는 쪽이 필요한 값을 한 번에 넘긴다. 그리는 쪽은 상태를 바꾸지 않는다
      function view() {
        return {
          objects, laneVisual, sliding, distance, speed, coins, nowMs,
          jumpT: nowMs < jumpEndMs ? 1 - (jumpEndMs - nowMs) / JUMP_MS : null,
          score: getScore(),
        };
      }

      return { reset, step, view, getState: () => state, getScore };
```

  `reset`, `step` 본문은 그대로 둔다.

- [ ] **Step 5: 점수판·비네트를 독립 함수로** — `createGame` 아래에 (기존 `drawHud` 본문에서 `ctx` 를 인자로,
  `getScore()`·`speed`·`coins` 를 `v.score`·`v.speed`·`v.coins` 로 바꾼 것):

```js
    // ── 점수판 — 3D 위에 얹은 #hud 캔버스에 그린다
    function drawHud(ctx, v) {
      const pad = 28;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      const score = String(v.score);
      ctx.font = `400 46px ${DISPLAY_FONT}`;
      const scoreW = ctx.measureText(score).width;
      ctx.fillStyle = C.ink;
      ctx.fillText(score, pad, pad + 40);
      ctx.fillStyle = C.inkDim;
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillText('점', pad + scoreW + 7, pad + 40);

      // 속도 게이지 — 막대는 한 단계분, 숫자는 몇 단계인지
      const barY = pad + 56;
      const gauge = speedGauge(v.speed);
      ctx.fillStyle = 'rgba(125, 214, 255, 0.16)';
      ctx.fillRect(pad, barY, 132, 3);
      ctx.fillStyle = C.cyan;
      ctx.fillRect(pad, barY, 132 * gauge.fill, 3);

      ctx.textBaseline = 'middle';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(`${gauge.level}단계`, pad + 142, barY + 2);

      // 코인 — 아이콘도 같은 금화다. 화면 안의 것과 같은 것임이 보여야 한다
      const cy = barY + 24;
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.arc(pad + 6, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.inkDim;
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText(String(v.coins), pad + 18, cy + 1);
      ctx.textBaseline = 'alphabetic';
    }

    // 빨라질수록 시야가 좁아진다. 그라디언트는 크기가 바뀔 때만 다시 만든다
    let vignetteCache = { key: '' };
    function drawVignette(ctx, W, H, strength) {
      const key = `${W}x${H}`;
      if (vignetteCache.key !== key) {
        const g = ctx.createRadialGradient(
          W / 2, H * 0.56, Math.min(W, H) * 0.28,
          W / 2, H * 0.56, Math.max(W, H) * 0.78
        );
        g.addColorStop(0, 'rgba(3, 5, 14, 0)');
        g.addColorStop(1, 'rgba(3, 5, 14, 0.75)');
        vignetteCache = { key, g };
      }
      ctx.globalAlpha = strength;
      ctx.fillStyle = vignetteCache.g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
```

- [ ] **Step 6: 3D 렌더러** — `drawVignette` 아래에:

```js
    // ── 3D 렌더러 — view() 값을 받아 Three.js 장면으로 그린다. 게임 상태를 바꾸지 않는다.
    // 세계 단위: 게임 z 1 = 1. 게임 z 는 멀수록 크고 카메라는 -z 를 보므로 세계 z = -게임 z
    const LANE_W = 2.4;       // 레인 간격
    const RUNNER_H = 1.8;     // 러너 키. 장애물 높이는 이것과 판정의 관계로 정했다 (설계 문서 표)
    const JUMP_H = 2.2;       // 점프 꼭대기 발 높이. 바리케이드(1.1)를 확실히 넘어 보여야 한다
    const GRID = 7;           // 바닥 격자 한 칸
    // 발광 효과는 GPU 를 먹는다. 포즈 추적과 같이 돌려 느리면 ?bloom=0 으로 끈다
    const BLOOM = new URLSearchParams(location.search).get('bloom') !== '0';

    const laneX = (lane) => (lane - 1) * LANE_W;

    function skyTexture(THREE) {
      const c = document.createElement('canvas');
      c.width = 2;
      c.height = 256;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, C.skyTop);
      grad.addColorStop(0.4, C.skyMid);
      grad.addColorStop(0.6, C.skyHorizon);
      grad.addColorStop(1, C.skyHorizon);
      g.fillStyle = grad;
      g.fillRect(0, 0, 2, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    function createRenderer3D(THREE, addons, canvas) {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

      const scene = new THREE.Scene();
      scene.background = skyTexture(THREE);
      // 스폰 지점(100)이 안개 속이다. 장애물이 멀리서 갑자기 튀어나오지 않고 서서히 드러난다
      scene.fog = new THREE.Fog(C.skyHorizon, 30, 95);

      const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 250);

      // 빛은 두 개뿐이다. 위는 보라, 아래는 청록 — 네온 도시의 반사광
      scene.add(new THREE.HemisphereLight(0x8f7dff, 0x1a4a6a, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4);
      sun.position.set(3, 8, 6);
      scene.add(sun);

      // 바닥 — 카메라 앞 20 부터 뒤로 220 까지
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(400, 240),
        new THREE.MeshStandardMaterial({ color: C.groundMid, roughness: 0.95 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.z = -100;
      scene.add(floor);

      // 달리는 면을 살짝 밝혀 '바닥' 이 아니라 '길' 로 읽히게 한다
      const track = new THREE.Mesh(
        new THREE.PlaneGeometry(LANE_W * 3, 240),
        new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.05, depthWrite: false })
      );
      track.rotation.x = -Math.PI / 2;
      track.position.set(0, 0.003, -100);
      scene.add(track);

      // 격자 — 세계가 흐르고 있다는 증거. 한 칸만큼만 움직였다 되돌아가면 끝없이 흐르는 것처럼 보인다
      const grid = new THREE.GridHelper(GRID * 34, 34, 0x2a6f9c, 0x1d4f7a);
      grid.material.transparent = true;
      grid.material.opacity = 0.55;
      grid.position.y = 0.006;
      scene.add(grid);

      // 레인 경계 4줄. 바깥은 밝고 굵게, 안쪽은 흐리게 (2D 때와 같은 규칙)
      for (const edge of [-0.5, 0.5, 1.5, 2.5]) {
        const outer = edge === -0.5 || edge === 2.5;
        const line = new THREE.Mesh(
          new THREE.BoxGeometry(outer ? 0.09 : 0.045, 0.02, 240),
          new THREE.MeshBasicMaterial({ color: C.cyan, transparent: !outer, opacity: outer ? 1 : 0.35 })
        );
        line.position.set(laneX(edge), 0.01, -100);
        scene.add(line);
      }

      // 상자 하나를 늘려 여러 모양으로 쓴다 (장애물·빌딩 공용)
      const unitBox = new THREE.BoxGeometry(1, 1, 1);
      const unitEdges = new THREE.EdgesGeometry(unitBox);

      let composer = null;
      if (BLOOM) {
        composer = new addons.EffectComposer(renderer);
        composer.addPass(new addons.RenderPass(scene, camera));
        // 문턱 0.55 — 발광 재질과 밝은 선만 번진다. 어두운 바닥·하늘은 그대로
        composer.addPass(new addons.UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.5, 0.55));
        composer.addPass(new addons.OutputPass());
      }

      // ── 장애물·러너 자리 (Task 3, 4 가 채운다)
      const meshes = new Map();
      const acquire = () => null;
      const release = () => {};

      let size = '';
      function resize(W, H) {
        const key = `${W}x${H}`;
        if (key === size) return;
        size = key;
        renderer.setSize(W, H, false);   // CSS 크기는 스타일시트가 정한다
        composer?.setSize(W, H);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
      }

      function scroll(dist) {
        grid.position.z = -100 + (dist % GRID);
      }

      // 러너 등 뒤 위. 레인을 옮기면 카메라는 절반만 따라간다 — 다 따라가면 옮긴 느낌이 안 난다
      function aim(laneVisual) {
        const x = laneX(laneVisual) * 0.5;
        camera.position.set(x, 3.4, -Z_CHAR + 6.5);
        camera.lookAt(x, 1.0, -Z_CHAR - 14);
      }

      function draw() {
        if (composer) composer.render();
        else renderer.render(scene, camera);
      }

      function render(v, W, H) {
        resize(W, H);
        scroll(v.distance);
        syncMeshes(meshes, v.objects, acquire, release);
        aim(v.laneVisual);
        draw();
      }

      // 메뉴 뒤에서도 세계는 흐른다. 장애물도 러너도 없다
      function renderIdle(atMs, W, H) {
        resize(W, H);
        scroll(atMs * 0.006);
        syncMeshes(meshes, [], acquire, release);
        aim(1);
        draw();
      }

      return { render, renderIdle };
    }
```

- [ ] **Step 7: 부트 연결** — 부트 섹션의 `const canvas = ...` 부터 `resizeCanvas();` 까지를 다음으로 바꾼다:

```js
    // ── 화면 전환·API·부트
    // #canvas 는 3D 전용이다. 여기에 2D 컨텍스트를 한 번이라도 요청하면 WebGL 을 얻을 수 없다
    const canvas = document.getElementById('canvas');
    const hud = document.getElementById('hud');
    const hudCtx = hud.getContext('2d');

    function resizeHud() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      hud.width = Math.floor(window.innerWidth * dpr);
      hud.height = Math.floor(window.innerHeight * dpr);
      // 백킹 스토어는 dpr 배 크지만 좌표는 CSS 픽셀로 다룬다. 캔버스 한 단위 = 화면 1px
      hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resizeHud);
    resizeHud();
```

  `boot()` 안에서 `const game = createGame(canvas);` → `const game = createGame();`

  `// 카메라와 MediaPipe 는 시작 화면을 보는 동안 미리 띄운다` 블록 바로 위에:

```js
      // 3D 엔진은 CDN 에서 받는다. 받는 동안에도 시작 화면과 랭킹은 보인다.
      // 못 받으면 게임을 할 수 없다 — 보이지 않는 장애물을 피하라고 할 수는 없다
      let view3d = null;
      (async () => {
        try {
          const [THREE, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] =
            await Promise.all([
              import('three'),
              import('three/addons/postprocessing/EffectComposer.js'),
              import('three/addons/postprocessing/RenderPass.js'),
              import('three/addons/postprocessing/UnrealBloomPass.js'),
              import('three/addons/postprocessing/OutputPass.js'),
            ]);
          view3d = createRenderer3D(THREE, { EffectComposer, RenderPass, UnrealBloomPass, OutputPass }, canvas);
        } catch (e) {
          console.error('3D 화면을 불러오지 못했다', e);
          el('start-btn').disabled = true;
          showBanner('3D 화면을 불러오지 못했습니다. 새로고침하거나 다른 브라우저로 열어 주세요');
        }
      })();

      function paintIdle(nowMs) {
        const W = window.innerWidth, H = window.innerHeight;
        view3d?.renderIdle(nowMs, W, H);
        hudCtx.clearRect(0, 0, W, H);
        drawVignette(hudCtx, W, H, 0.6);
      }

      function paintPlay() {
        const W = window.innerWidth, H = window.innerHeight;
        const v = game.view();
        view3d?.render(v, W, H);
        hudCtx.clearRect(0, 0, W, H);
        // 점수판보다 먼저 칠해야 점수가 같이 어두워지지 않는다
        const t = (v.speed - BASE_SPEED) / (DARK_SPEED - BASE_SPEED);
        drawVignette(hudCtx, W, H, 0.55 + 0.45 * Math.min(1, Math.max(0, t)));
        drawHud(hudCtx, v);
      }
```

  `loop` 안의 `game.renderIdle(window.innerWidth, window.innerHeight, nowMs);` 두 곳 → `paintIdle(nowMs);`
  `game.render(window.innerWidth, window.innerHeight);` → `paintPlay();`

- [ ] **Step 8: 셀프 테스트** — `node $SP/run-selftests.mjs public/index.html` → 기대 `21/21`

- [ ] **Step 9: 남은 2D 흔적 확인** —
  `grep -nE "project\(|laneScreenX|WORLD_SCALE|HORIZON_RATIO|drawWorld|canvas\.getContext" public/index.html`
  기대: 출력 없음 (Review Focus 5)

- [ ] **Step 10: 서버 테스트** — `npm test` → 기대: 전부 pass

- [ ] **Step 11: 브라우저 확인** — `npm run dev` 를 백그라운드로 띄우고 크롬에서 `http://localhost:8787/`:
  시작 화면 뒤로 3D 바닥 격자가 다가오고 레인 선 4줄이 소실점으로 모인다, 안개 너머로 하늘 그라디언트,
  콘솔에 오류 없음. `?bloom=0` 도 같은 화면(발광만 없다). 시작 → 준비 화면 대기 → 게임 중 점수판이 보인다.

- [ ] **Step 12: 커밋**

```bash
git add public/index.html
git commit -m "그리기를 게임 로직에서 떼어 내고 Three.js 3D 무대를 세움"
```

---

### Task 3: 장애물·코인 3D 모형

**Files:**
- Modify: `public/index.html` — `createRenderer3D` 의 "장애물·러너 자리" 블록과 `render()`

**Interfaces:**
- Consumes: `syncMeshes`, `laneX`, `scene`, `meshes` (Task 1, 2)
- Produces: `acquire(kind)` / `release(kind, group)` — 종류는 `'coin' | 'barricade' | 'beam' | 'pillar'`

- [ ] **Step 1: 모형 만들기** — "장애물·러너 자리" 블록의 `const meshes`·`acquire`·`release` 세 줄을 다음으로 바꾼다:

```js
      // ── 장애물 — 지오메트리와 재질은 종류마다 하나씩만 만들어 공유한다. 새로 만드는 건 껍데기뿐이다
      const lit = (color, glow = 0, extra = {}) => new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: glow, roughness: 0.55, metalness: 0.1, ...extra,
      });
      const glowLine = (color) => new THREE.LineBasicMaterial({ color });

      // 바리케이드 경고 줄무늬. 줄무늬 자체가 빛나야 어두운 트랙에서 읽힌다
      const stripes = (() => {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 64;
        const g = c.getContext('2d');
        g.fillStyle = C.emberDark;
        g.fillRect(0, 0, 128, 64);
        g.fillStyle = C.ember;
        for (let x = -64; x < 128; x += 32) {
          g.beginPath();
          g.moveTo(x, 64); g.lineTo(x + 16, 64); g.lineTo(x + 80, 0); g.lineTo(x + 64, 0);
          g.closePath();
          g.fill();
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();

      const shadowGeo = new THREE.CircleGeometry(1, 24);
      const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
      const M = {
        gold: lit(C.gold, 0.7, { metalness: 0.6, roughness: 0.3 }),
        stripes: new THREE.MeshStandardMaterial({ map: stripes, emissiveMap: stripes, emissive: 0xffffff, emissiveIntensity: 0.45 }),
        emberTop: new THREE.MeshBasicMaterial({ color: C.emberLight }),
        beam: lit('#0f4a6e', 0.15),
        beamPost: lit('#0f2a44'),
        cyan: new THREE.MeshBasicMaterial({ color: C.cyan }),
        pillar: lit(C.violetDark, 0.35),
        violet: glowLine(C.violet),
      };
      const coinGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.08, 28);

      function box(mat, w, h, d, x, y) {
        const m = new THREE.Mesh(unitBox, mat);
        m.scale.set(w, h, d);
        m.position.set(x, y, 0);
        return m;
      }

      // 바닥 그림자 — 물체가 땅에 붙어 있다는 가장 싼 단서다
      function shadow(rx, rz) {
        const m = new THREE.Mesh(shadowGeo, shadowMat);
        m.rotation.x = -Math.PI / 2;
        m.scale.set(rx, rz, 1);
        m.position.y = 0.012;
        return m;
      }

      // 치수는 설계 문서 표 그대로. 높이는 판정(점프·슬라이드)과의 관계로 정했다
      const BUILD = {
        coin() {
          const g = new THREE.Group();
          const disc = new THREE.Mesh(coinGeo, M.gold);
          disc.rotation.x = Math.PI / 2;   // 납작한 면이 카메라를 본다
          disc.position.y = 1.5;
          g.add(disc);
          return g;
        },
        // 점프 꼭대기(2.2)보다 한참 낮다 — '뛰어넘는다' 로 읽혀야 한다
        barricade() {
          const g = new THREE.Group();
          g.add(shadow(1.1, 0.4), box(M.stripes, 1.7, 1.1, 0.35, 0, 0.55), box(M.emberTop, 1.72, 0.06, 0.37, 0, 1.13));
          return g;
        },
        // 아래 끝 1.2 — 선 키(1.8)보다 낮고 슬라이드 높이(약 0.7)보다 높다. 그 틈을 청록으로 밝힌다
        beam() {
          const g = new THREE.Group();
          g.add(
            box(M.beam, 1.7, 0.75, 0.3, 0, 1.2 + 0.375),
            box(M.cyan, 1.7, 0.08, 0.32, 0, 1.24),
            box(M.beamPost, 0.08, 1.95, 0.08, -0.85, 0.975),
            box(M.beamPost, 0.08, 1.95, 0.08, 0.85, 0.975),
          );
          return g;
        },
        // 넘을 수도 숙일 수도 없다. 가장 높고 모서리가 빛난다
        pillar() {
          const g = new THREE.Group();
          const edges = new THREE.LineSegments(unitEdges, M.violet);
          edges.scale.set(0.86, 4.01, 0.86);
          edges.position.y = 2;
          g.add(shadow(0.75, 0.5), box(M.pillar, 0.85, 4, 0.85, 0, 2), edges);
          return g;
        },
      };

      const meshes = new Map();
      const pools = { coin: [], barricade: [], beam: [], pillar: [] };
      function acquire(kind) {
        let g = pools[kind].pop();
        if (!g) {
          g = BUILD[kind]();
          scene.add(g);
        }
        g.visible = true;
        return g;
      }
      function release(kind, g) {
        g.visible = false;
        pools[kind].push(g);
      }
```

- [ ] **Step 2: 위치 갱신** — `render()` 의 `syncMeshes(...)` 줄 바로 아래에:

```js
        for (const [o, g] of meshes) {
          g.position.set(laneX(o.lane), 0, -o.z);
          // 돌아가는 금화 — 레인마다 위상을 달리해 줄이 한 덩어리로 돌지 않게 한다
          if (o.kind === 'coin') g.rotation.y = v.nowMs / 320 + o.lane * 1.7;
        }
```

- [ ] **Step 3: 셀프 테스트** — `node $SP/run-selftests.mjs public/index.html` → `21/21`

- [ ] **Step 4: 브라우저 확인** — `http://localhost:8787/` 에서 키보드로 플레이:
  바리케이드(줄무늬 낮은 상자), 빔(떠 있는 막대 + 청록 아랫단 + 기둥 둘), 기둥(보라 발광 모서리),
  코인(도는 금화)이 안개 속에서 나타나 다가온다. 콘솔로 풀 크기를 확인할 수 있게 잠시
  `window.__pools = pools` 를 넣어 1분 달린 뒤 `Object.values(__pools).map(p => p.length)` 가 수십 개 이하인지 본다
  (확인 후 그 줄은 지운다). 게임오버 → 시작 화면에서 장애물이 하나도 안 보여야 한다 (Review Focus 3, 4)

- [ ] **Step 5: 커밋**

```bash
git add public/index.html
git commit -m "장애물과 코인을 3D 모형으로 그림"
```

---

### Task 4: 러너 3D 모형과 동작

**Files:**
- Modify: `public/index.html` — `createRenderer3D` 안, `pools` 선언 아래와 `render()`/`renderIdle()`

**Interfaces:**
- Consumes: `view().laneVisual`, `jumpT`, `sliding`, `distance` (Task 2), `laneX`, `JUMP_H`, `RUNNER_H`
- Produces: 없음 (렌더러 내부)

- [ ] **Step 1: 러너 모형** — `release` 함수 아래에:

```js
      // ── 러너 — 뒤에서 본다. 팔다리는 관절(Group)에 매단 캡슐이라 관절을 돌리면 휘두른다.
      // 모든 치수는 발밑이 원점, 키 RUNNER_H 기준
      const runner = (() => {
        const skin = lit(C.mint, 0.3, { roughness: 0.4 });
        const shade = lit(C.mintDark, 0.2, { roughness: 0.4 });
        const root = new THREE.Group();   // 발밑. 슬라이드는 이것을 뒤로 눕힌다
        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 6, 12), skin);
        torso.position.y = 1.15;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), skin);
        head.position.y = RUNNER_H - 0.2;
        root.add(torso, head);
        // 관절에서 아래로 매단다. 관절을 +x 로 돌리면 끝이 앞(-z)으로 간다
        function limb(x, y, len, r, mat) {
          const joint = new THREE.Group();
          joint.position.set(x, y, 0);
          const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - 2 * r, 4, 10), mat);
          m.position.y = -len / 2;
          joint.add(m);
          root.add(joint);
          return joint;
        }
        const legL = limb(-0.12, 0.8, 0.8, 0.1, shade);
        const legR = limb(0.12, 0.8, 0.8, 0.1, skin);
        const armL = limb(-0.3, 1.45, 0.65, 0.07, shade);
        const armR = limb(0.3, 1.45, 0.65, 0.07, skin);
        // 뜰수록 작고 흐려진다. 얼마나 높이 떠 있는지 읽는 유일한 단서다
        const blob = new THREE.Mesh(shadowGeo, shadowMat.clone());
        blob.rotation.x = -Math.PI / 2;
        blob.position.y = 0.012;
        scene.add(root, blob);
        return { root, legL, legR, armL, armR, blob };
      })();

      const SLIDE_TILT = 1.2;   // 약 70°. 머리가 0.8 아래로 내려와 빔(아래 끝 1.2) 밑을 지나가 보인다

      function poseRunner(v) {
        const r = runner;
        const x = laneX(v.laneVisual);
        let y = 0;
        if (v.jumpT !== null) {
          y = Math.sin(v.jumpT * Math.PI) * JUMP_H;
          r.legL.rotation.x = r.legR.rotation.x = 0.9;   // 다리를 앞으로 접는다
          r.armL.rotation.x = r.armR.rotation.x = 2.6;   // 팔을 머리 위로
          r.root.rotation.x = 0;
        } else if (v.sliding) {
          // 몸이 뒤로 누우면 다리는 저절로 앞을 향한다
          r.legL.rotation.x = r.legR.rotation.x = 0;
          r.armL.rotation.x = r.armR.rotation.x = 0.6;
          r.root.rotation.x = SLIDE_TILT;
        } else {
          // 달리기 위상은 이동 거리로 돌린다. 빨라지면 발도 저절로 빨라진다
          const s = Math.sin(v.distance * 0.55);
          r.legL.rotation.x = s * 0.8;
          r.legR.rotation.x = -s * 0.8;
          r.armL.rotation.x = -s * 0.7;
          r.armR.rotation.x = s * 0.7;
          r.root.rotation.x = 0;
        }
        r.root.position.set(x, y, -Z_CHAR);
        const near = 1 - Math.min(y / (JUMP_H * 1.2), 0.62);
        r.blob.position.set(x, 0.012, -Z_CHAR);
        r.blob.scale.set(0.55 * near, 0.35 * near, 1);
        r.blob.material.opacity = 0.45 * near;
      }
```

- [ ] **Step 2: 그릴 때 러너 켜고 끄기** — `render()` 의 `aim(v.laneVisual);` 바로 위에:

```js
        runner.root.visible = runner.blob.visible = true;
        poseRunner(v);
```

  `renderIdle()` 의 `aim(1);` 바로 위에:

```js
        runner.root.visible = runner.blob.visible = false;
```

- [ ] **Step 3: 셀프 테스트** — `node $SP/run-selftests.mjs public/index.html` → `21/21`

- [ ] **Step 4: 브라우저 확인** — 키보드로:
  러너가 팔다리를 흔들며 달린다, `←`/`→` 로 레인을 옮기면 부드럽게 이동하고 카메라가 절반만 따라간다,
  `↑` 점프 때 무릎을 접고 팔을 들며 그림자가 작아진다, `↓` 누르는 동안 뒤로 누워 미끄러진다.
  빔을 슬라이드로 지나갈 때 머리가 빔 아래로 지나가 보이고, 바리케이드를 점프로 넘을 때 발이 상자 위로 지나가 보인다.
  시작 화면에서는 러너가 안 보인다.

- [ ] **Step 5: 커밋**

```bash
git add public/index.html
git commit -m "러너를 3D 도형으로 만들고 달리기·점프·슬라이드 동작을 붙임"
```

---

### Task 5: 네온 빌딩, 문서, 전체 확인

**Files:**
- Modify: `public/index.html` — `createRenderer3D` 의 레인 선 블록 아래, `scroll()`
- Modify: `README.md` — "참고" 섹션

**Interfaces:**
- Consumes: `mulberry32`, `scene`, `unitBox`, `unitEdges` (Task 2)

- [ ] **Step 1: 빌딩** — `const unitEdges = ...` 줄 바로 아래에:

```js
      // 네온 도시 — 트랙 양옆 빌딩. 모양은 고정 시드로 한 번만 정하고 z 만 흘린다.
      // 카메라 뒤로 지나간 빌딩은 안개 너머(-200)로 돌아간다. 거기는 이미 안개 색이라 튀어나오지 않는다
      const CITY_SPAN = 210;
      const city = (() => {
        const rng = mulberry32(7);
        const winMat = new THREE.MeshStandardMaterial({ color: '#0c0722', roughness: 0.8 });
        const edgeMats = [new THREE.LineBasicMaterial({ color: C.violet }), new THREE.LineBasicMaterial({ color: C.cyan })];
        const out = [];
        for (const side of [-1, 1]) {
          for (let z0 = 0; z0 < CITY_SPAN; z0 += 9 + rng() * 6) {
            const w = 3 + rng() * 4, h = 6 + rng() * 24, d = 4 + rng() * 5;
            const g = new THREE.Group();
            const body = new THREE.Mesh(unitBox, winMat);
            const edges = new THREE.LineSegments(unitEdges, edgeMats[out.length % 2]);
            body.scale.set(w, h, d);
            edges.scale.set(w, h, d);
            g.add(body, edges);
            g.position.set(side * (LANE_W * 1.5 + 3 + w / 2 + rng() * 6), h / 2, 0);
            scene.add(g);
            out.push({ g, z0 });
          }
        }
        return out;
      })();
```

- [ ] **Step 2: 빌딩 흘리기** — `scroll()` 을:

```js
      function scroll(dist) {
        grid.position.z = -100 + (dist % GRID);
        for (const b of city) b.g.position.z = -200 + (((b.z0 + dist) % CITY_SPAN) + CITY_SPAN) % CITY_SPAN;
      }
```

- [ ] **Step 3: README** — "참고" 섹션 끝에 한 문단 추가:

```markdown
화면은 Three.js 로 그린 3D 장면이다(인터넷에서 받아온다). 포즈 추적과 같이 돌려서 버벅이면
주소 끝에 `?bloom=0` 을 붙여 발광 효과를 끈다(예: `http://localhost:8787/?bloom=0`).
```

- [ ] **Step 4: 전체 자동 확인**
  - `node $SP/run-selftests.mjs public/index.html` → `21/21`
  - `npm test` → 전부 pass

- [ ] **Step 5: 브라우저 전체 확인** (크롬, `npm run dev`)
  1. 시작 화면: 양옆 네온 빌딩이 흘러가고 러너·장애물 없음
  2. 키보드로 1분 이상 플레이: 레인 이동·점프·슬라이드·코인 획득, 점수판 숫자 증가, 빨라질수록 가장자리 어두워짐
  3. 기둥에 부딪혀 게임오버 → 점수 화면 → 시작 화면 복귀 시 이전 장애물 없음
  4. 게임 중 창 크기 변경 → 3D·점수판 모두 새 크기 (Review Focus 1)
  5. `?bloom=0` 동작
  6. 실패 경로: importmap 의 `0.186.1` 을 잠시 `0.0.0` 으로 바꿔 새로고침 → 시작 버튼 비활성 + 안내 문구,
     `?test=1` 은 여전히 결과 표시 → 원래대로 되돌림 (Review Focus 2)
  7. 콘솔 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add public/index.html README.md
git commit -m "양옆에 네온 빌딩을 세우고 README 에 발광 끄는 법 추가"
```
