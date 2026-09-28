# 한낮의 팝 도시 디자인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네온 "밤의 터널" 화면을 한낮의 팝 도시(파란 하늘·기찻길·알록달록 건물·흰 스티커 메뉴)로 바꾼다. 판정과 게임 로직은 그대로.

**Architecture:** 모든 것이 `public/index.html` 한 파일에 있다. 3D 세상은 `createRenderer3D()`(Three.js 기본 도형 + 캔버스 텍스처), 점수판은 `drawHud()`/`drawVignette()`(2D 캔버스), 메뉴는 `<style>` 의 CSS 다. 색은 CSS `:root` 와 스크립트 `C` 두 곳에 같은 값으로 둔다. 세계 → 장애물·러너 → 점수판 → 메뉴 순으로 바꾸고, 매 단계가 끝나면 게임이 그대로 돈다.

**Tech Stack:** Three.js 0.186.1 (jsDelivr CDN, importmap), Canvas 2D, 순수 CSS, Cloudflare Workers(`wrangler dev`), 페이지 안 셀프 테스트(`?test=1`), `node --test`

**Spec:** `docs/superpowers/specs/2026-09-28-daytime-pop-city-design.md`

## Global Constraints

- 파일은 `public/index.html` 과 `README.md` 만 고친다. 새 파일·새 라이브러리·3D 모델 파일 금지
- 게임 로직(스폰, 충돌 `clears()`/`step()`, 속도, 점수, 포즈 인식, 키보드, 화면 순서·문구, 랭킹 API)은 한 글자도 바꾸지 않는다
- 장애물 **높이** 고정: 바리케이드 1.1, 문 아래 끝 1.2, 코인 높이 1.5. 전철(기존 pillar)만 폭 2.0 × 높이 3.2 × 깊이 1.2
- CSS `:root` 의 `#hex` 색 변수는 모두 `C` 에 camelCase 로 같은 값이 있어야 한다 (`--ink-dim` ↔ `C.inkDim`)
- 메뉴 글자 색은 흰 바탕 대비 4.5:1 이상 — ink `#1d2b53`, inkDim `#4a5b88`, inkFaint `#5f6f9c`
- 발광(bloom) 코드, `?bloom=0`, `three/addons` importmap 항목은 모두 지운다
- 그대로 두는 것: 디버그 패널의 모양(글자색만 밝게 고정), 카메라 준비 화면의 선·졸라맨 그림, `/admin`
- 코드 주석은 지금처럼 한국어 반말 서술체("~다")로, 무엇보다 **왜**를 적는다
- 커밋 메시지는 한국어 한 줄 + 빈 줄 + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. **3D 를 못 불러왔을 때** — 시작 버튼은 막히고, 빨간 테두리 경고 배너가 밝은 시작 화면 위에서 또렷이 읽혀야 한다 (Task 4 Step 6)
2. **아주 긴 점수(7자리 이상)** — 점수판 카드가 글자를 따라 늘어나야 하고 숫자가 카드 밖으로 삐져나가면 안 된다 (Task 3 Step 1 테스트)
3. **좁은 화면(폭 390px)** — 시작 카드가 위아래로 쌓이고 테두리 두른 제목이 잘리지 않아야 한다 (Task 5 Step 4)
4. **12자 닉네임 랭킹** — 메달 칸과 점수 칸을 밀어내지 않고 말줄임(…)으로 줄어야 한다 (Task 5 Step 5)
5. **디버그 패널(D 키)** — 본문 글자색이 남색으로 바뀌어도 어두운 패널 위 글자가 밝게 읽혀야 한다 (Task 4 Step 7)

---

## 공용 도구: 셀프 테스트를 브라우저 없이 돌리기

페이지 안 셀프 테스트(`runSelfTests()`, 브라우저에서는 `/?test=1`)를 node 로 돌리는 일회용 스크립트다.
**저장소에 넣지 않는다.** 스크래치 폴더(예: `$TMPDIR/selftest.mjs`)에 만든다.

```js
// public/index.html 의 셀프 테스트(?test=1)를 브라우저 없이 돌린다. 사용: node selftest.mjs <repo>/public/index.html
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const html = readFileSync(process.argv[2], 'utf8');
const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
let body = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
body = body.replace(/if \(new URLSearchParams\(location\.search\)\.get\('test'\) === '1'\) \{[\s\S]*$/,
  'globalThis.__results = runSelfTests();\n');

const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
const stubEl = {
  width: 0, height: 0, content: '', textContent: '', value: '',
  style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => noop, addEventListener() {}, getBoundingClientRect: () => ({ width: 0, height: 0 }),
};
Object.assign(globalThis, {
  window: globalThis, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener() {}, requestAnimationFrame() {}, matchMedia: () => ({ matches: false }),
  location: { search: '' },
  document: {
    getElementById: () => stubEl, querySelector: () => stubEl,
    querySelectorAll: (sel) => (sel === 'style' ? styles.map((textContent) => ({ textContent })) : []),
    createElement: () => stubEl, body: {}, fonts: { load: () => Promise.resolve() },
  },
});

const out = new URL('./__selftest_body.mjs', import.meta.url);
writeFileSync(out, body);
await import(pathToFileURL(out.pathname).href);
const r = globalThis.__results;
for (const t of r) console.log(`${t.ok ? 'PASS' : 'FAIL'} ${t.name}${t.msg ? ' — ' + t.msg : ''}`);
console.log(`${r.filter((t) => t.ok).length} / ${r.length} 통과`);
process.exit(r.every((t) => t.ok) ? 0 : 1);
```

이 계획서에서 "셀프 테스트 실행" = `node $TMPDIR/selftest.mjs public/index.html` (저장소 루트에서).
시작 시점 기준값: **21 / 21 통과**, `npm test` **6 / 6 통과**.

"브라우저 확인" = `npm run dev` 를 띄워 둔 채(처음이면 README 대로 `npx wrangler d1 execute pose-runner --local --file=schema.sql` 먼저)
`http://localhost:8787/` 을 열어 스크린샷을 찍는다. 카메라 권한은 거부해도 된다 — 방향키로 플레이한다.
자동화 탭이 뒤에 숨어 있으면 `requestAnimationFrame` 이 멈추니, 클릭과 스크린샷을 연달아 한다.

---

### Task 1: 하늘·바닥·선로·건물, 발광 제거

**Files:**
- Modify: `public/index.html` — importmap(14-21행 근처), 팔레트 `C`(1014-1023행 근처), 3D 렌더러 앞부분(1240-1358행 근처), `render` 쪽 `resize`/`scroll`/`draw`(1560-1590행 근처), 부트의 3D 불러오기(2078-2090행 근처)
- Modify: `README.md` — 마지막 단락

**Interfaces:**
- Produces: 새 팔레트 `C`(아래 전체 키), `BUILDING_COLORS`, `createRenderer3D(THREE, canvas)` — 두 번째 인자 `addons` 가 사라진다
- Task 2·3 이 쓰는 `C` 키: `ink inkDim inkFaint paper line lineSoft yellow yellowDark red redLight stripeRed blue blueDark pink skin skinDark lamp green skyMid`
- 과도기 키 `cyan mint mintDark gold ember emberLight emberDark violet violetDark` — Task 2·3 이 지운다

- [ ] **Step 1: 기준 확인**

Run: `node $TMPDIR/selftest.mjs public/index.html && npm test`
Expected: `21 / 21 통과`, `pass 6`

- [ ] **Step 2: importmap 에서 addons 를 지운다**

```html
  <!-- 3D 엔진. 모듈 스크립트가 boot() 안에서 필요할 때 부른다 — ?test=1 은 부르지 않는다 -->
  <script type="importmap">
    {
      "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js"
      }
    }
  </script>
```

- [ ] **Step 3: 팔레트 `C` 를 통째로 바꾼다**

`// ── 팔레트 — 위 CSS :root 와 같은 값이다.` 줄부터 `const C = { ... };` 끝까지를 아래로 바꾼다 (`DISPLAY_FONT` 줄은 그대로):

```js
    // ── 팔레트 — 위 CSS :root 와 같은 값이다. 한쪽만 바꾸면 화면이 갈라진다
    const C = {
      skyTop: '#4fb8ff', skyMid: '#bfe9ff', skyHorizon: '#fff4c9',
      grass: '#8fd16a', gravel: '#b9a58f', tie: '#8a6a4f', rail: '#d9dde3',
      ink: '#1d2b53', inkDim: '#4a5b88', inkFaint: '#5f6f9c',
      paper: '#ffffff', line: '#d7def0', lineSoft: '#e6ebf7',
      yellow: '#ffcc00', yellowDark: '#d99a00',
      red: '#e8453c', redLight: '#ff7a70', stripeRed: '#ff4d4d',
      blue: '#2f5bd3', blueDark: '#23449e', pink: '#ff4d8d',
      skin: '#ffcf9e', skinDark: '#e8b27f', lamp: '#fff6b0',
      green: '#2fbf71',
      // 옛 네온 색 — 장애물·러너와 점수판을 옮기면 지운다
      cyan: '#4de3ff', mint: '#7ef6a0', mintDark: '#3fbf74', gold: '#ffd34d',
      ember: '#ff6a4d', emberLight: '#ffb199', emberDark: '#7a2418',
      violet: '#b06dff', violetDark: '#3b1a6b',
    };
    // 건물 색. 건물마다 돌려 쓴다
    const BUILDING_COLORS = ['#ff7a59', '#ffd23f', '#3dd68c', '#8b7bff', '#ff4d8d', '#35b6ff'];
```

- [ ] **Step 4: 렌더러 앞부분을 바꾼다**

`const GRID = 7;` 줄부터 `if (BLOOM) { ... }` 블록의 닫는 `}` 까지(=`skyTexture` 함수, `createRenderer3D` 의 시작부터 `composer` 까지)를 아래로 바꾼다.
`skyTexture` 는 내용이 같다(색은 `C` 가 바뀌어 저절로 바뀐다).

```js
    const TIE = 1.2;          // 침목 간격. 선로 무늬 한 칸이다

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

    function createRenderer3D(THREE, canvas) {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

      const scene = new THREE.Scene();
      scene.background = skyTexture(THREE);
      // 스폰 지점(100)이 안개 속이다. 장애물이 멀리서 갑자기 튀어나오지 않고 하늘빛에서 서서히 드러난다
      scene.fog = new THREE.Fog(C.skyHorizon, 30, 95);

      const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 250);

      // 한낮이다. 위는 하늘빛, 아래는 잔디에서 튀는 빛 — 그늘진 면도 까맣게 죽지 않는다
      scene.add(new THREE.HemisphereLight(C.skyMid, C.grass, 1.3));
      const sun = new THREE.DirectionalLight(0xffffff, 2.0);
      sun.position.set(3, 8, 6);
      scene.add(sun);

      // 바닥 — 선로 밖은 잔디. 카메라 앞 20 부터 뒤로 220 까지
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(400, 240),
        new THREE.MeshStandardMaterial({ color: C.grass, roughness: 1 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.z = -100;
      scene.add(floor);

      // 선로 — 자갈 위 침목. 텍스처 한 칸 = 침목 하나, 가로로 레인 수만큼 반복한다.
      // 흐름은 텍스처를 밀어서 낸다: TIE 만큼 달리면 정확히 한 칸 밀려 끝없이 흐르는 것처럼 보인다
      const ties = (() => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const g = c.getContext('2d');
        g.fillStyle = C.gravel;
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = C.tie;
        g.fillRect(6, 22, 52, 20);   // 양옆을 비워 레인 사이에 자갈 틈이 보이게 한다
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(3, 240 / TIE);
        // 비스듬히 누운 면이라 멀리 갈수록 무늬가 뭉개진다. 비등방 필터가 그걸 늦춘다
        t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        return t;
      })();
      const track = new THREE.Mesh(
        new THREE.PlaneGeometry(LANE_W * 3, 240),
        new THREE.MeshStandardMaterial({ map: ties, roughness: 1 })
      );
      track.rotation.x = -Math.PI / 2;
      track.position.set(0, 0.003, -100);
      scene.add(track);

      // 레일 — 레인마다 두 줄. z 방향으로 모양이 같아서 흘릴 필요가 없다
      const railMat = new THREE.MeshStandardMaterial({ color: C.rail, metalness: 0.6, roughness: 0.35 });
      const railGeo = new THREE.BoxGeometry(0.08, 0.1, 240);
      for (let lane = 0; lane < 3; lane++) {
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(railGeo, railMat);
          rail.position.set(laneX(lane) + side * 0.55, 0.05, -100);
          scene.add(rail);
        }
      }

      // 상자 하나를 늘려 여러 모양으로 쓴다 (장애물·건물 공용)
      const unitBox = new THREE.BoxGeometry(1, 1, 1);
      const unitEdges = new THREE.EdgesGeometry(unitBox);

      // 도시 — 트랙 양옆 알록달록한 건물. 모양은 고정 시드로 한 번만 정하고 z 만 흘린다.
      // 카메라 뒤로 지나간 건물은 안개 너머(-200)로 돌아간다. 거기는 이미 안개 색이라 튀어나오지 않는다
      const CITY_SPAN = 210;
      const city = (() => {
        const rng = mulberry32(7);
        // 창문 무늬는 색마다 한 장. 건물마다 반복 횟수만 다른 복사본을 쓴다 (그림 자체는 공유된다)
        const windowTex = BUILDING_COLORS.map((color) => {
          const c = document.createElement('canvas');
          c.width = 32;
          c.height = 32;
          const g = c.getContext('2d');
          g.fillStyle = color;
          g.fillRect(0, 0, 32, 32);
          g.fillStyle = 'rgba(255, 255, 255, 0.8)';
          g.fillRect(9, 8, 14, 16);   // 한 칸에 창문 하나
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          return t;
        });
        const roofMats = BUILDING_COLORS.map((color) =>
          new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), roughness: 0.9 }));
        // 창문 한 칸은 폭 1.6, 높이 2.2. 반복 횟수를 면 크기에 맞춰야 창문이 늘어나 보이지 않는다
        function windows(i, across, h) {
          const t = windowTex[i].clone();
          t.repeat.set(Math.max(1, Math.round(across / 1.6)), Math.max(1, Math.round(h / 2.2)));
          t.needsUpdate = true;
          return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
        }
        const out = [];
        for (const side of [-1, 1]) {
          for (let z0 = 0; z0 < CITY_SPAN; z0 += 9 + rng() * 6) {
            const w = 3 + rng() * 4, h = 6 + rng() * 24, d = 4 + rng() * 5;
            const i = out.length % BUILDING_COLORS.length;
            const sideMat = windows(i, d, h), frontMat = windows(i, w, h);
            // 상자 면 순서: +x, -x, +y, -y, +z, -z. 옆면은 깊이, 앞뒤는 폭 기준으로 창문을 깐다
            const body = new THREE.Mesh(unitBox, [sideMat, sideMat, roofMats[i], roofMats[i], frontMat, frontMat]);
            body.scale.set(w, h, d);
            // 지붕 테두리 — 조금 넓고 얇은 어두운 판. 하늘과 건물의 경계를 또렷하게 한다
            const roof = new THREE.Mesh(unitBox, roofMats[i]);
            roof.scale.set(w + 0.4, 0.5, d + 0.4);
            roof.position.y = h / 2 + 0.25;
            const g = new THREE.Group();
            g.add(body, roof);
            g.position.set(side * (LANE_W * 1.5 + 7 + w / 2 + rng() * 6), h / 2, 0);
            scene.add(g);
            out.push({ g, z0 });
          }
        }
        return out;
      })();
```

`const BLOOM = ...` 줄과 그 위 주석(`// 발광 효과는 GPU 를 먹는다...`)도 지운다. `const GRID` 는 위 블록에서 이미 사라졌다.

- [ ] **Step 5: `resize` / `scroll` / `draw` 를 고친다**

```js
      let size = '';
      function resize(W, H) {
        const key = `${W}x${H}`;
        if (key === size) return;
        size = key;
        renderer.setSize(W, H, false);   // CSS 크기는 스타일시트가 정한다
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
      }

      function scroll(dist) {
        // 침목이 러너 쪽으로 흘러와야 한다. 건물과 반대로 흐르면 부호를 뒤집는다
        ties.offset.y = (dist / TIE) % 1;
        for (const b of city) b.g.position.z = -200 + (((b.z0 + dist) % CITY_SPAN) + CITY_SPAN) % CITY_SPAN;
      }
```

```js
      function draw() {
        renderer.render(scene, camera);
      }
```

- [ ] **Step 6: 부트에서 addons 를 부르지 않는다**

`const [THREE, { EffectComposer }, ...] = await Promise.all([...]);` 와 다음 줄 `view3d = createRenderer3D(...)` 를 아래 두 줄로 바꾼다:

```js
          const THREE = await import('three');
          view3d = createRenderer3D(THREE, canvas);
```

- [ ] **Step 7: README 의 발광 안내를 지운다**

`README.md` 마지막 단락을 한 줄로 바꾼다:

```markdown
화면은 Three.js 로 그린 3D 장면이다(인터넷에서 받아온다).
```

- [ ] **Step 8: 남은 흔적 검색**

Run: `grep -nE "bloom|BLOOM|composer|GridHelper|addons|GRID\b" public/index.html README.md`
Expected: 출력 없음

- [ ] **Step 9: 셀프 테스트 실행**

Run: `node $TMPDIR/selftest.mjs public/index.html && npm test`
Expected: `21 / 21 통과`, `pass 6`

- [ ] **Step 10: 브라우저 확인**

`http://localhost:8787/` 시작 화면 뒤 배경을 스크린샷.
Expected: 파란 하늘→연노랑 지평선, 초록 잔디, 갈색 침목·은색 레일 3레인, 창문 달린 알록달록 건물. 콘솔 오류 없음.
2초쯤 지켜보거나 GIF 로 녹화해 **침목이 건물과 같은 방향(화면 아래쪽, 러너 쪽)으로 흐르는지** 확인한다. 반대면 Step 5 의 `ties.offset.y` 부호를 `-` 로 바꾼다.
(메뉴 카드는 아직 어두운 네온이다 — Task 4 에서 바뀐다.)

- [ ] **Step 11: 커밋**

```bash
git add public/index.html README.md
git commit -m "하늘·잔디·기찻길·창문 달린 건물로 3D 배경을 바꾸고 발광 효과를 지움

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 장애물·코인·러너

**Files:**
- Modify: `public/index.html` — `// ── 장애물` 부터 `BUILD` 객체 끝까지(1360-1480행 근처), 러너 생성(1498-1530행 근처), `poseRunner` 의 그림자 불투명도 한 줄, 팔레트 과도기 키

**Interfaces:**
- Consumes: Task 1 의 `C` 새 키, `unitBox`, `shadow()`
- Produces: `box(mat, w, h, d, x, y, z = 0)` — z 인자가 생긴다. `BUILD.pillar()` 는 이름 그대로(게임 로직의 `kind: 'pillar'` 와 짝) 전철 모양을 만든다

- [ ] **Step 1: 장애물 재질·텍스처·BUILD 를 바꾼다**

`// ── 장애물 — 지오메트리와 재질은...` 줄부터 `const BUILD = { ... };` 끝까지를 아래로 바꾼다:

```js
      // ── 장애물 — 지오메트리와 재질은 종류마다 하나씩만 만들어 공유한다. 새로 만드는 건 껍데기뿐이다
      const lit = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...extra });

      // 바리케이드 공사 줄무늬. 빨강·흰 사선은 누구나 '막혔으니 넘어라' 로 읽는다
      const stripes = (() => {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 64;
        const g = c.getContext('2d');
        g.fillStyle = C.paper;
        g.fillRect(0, 0, 128, 64);
        g.fillStyle = C.stripeRed;
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

      // 문 앞면의 아래 화살표 ▼. 바리케이드 줄무늬가 '넘어라' 이듯 이것은 '숙여라' 다
      const chevrons = (() => {
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 64;
        const g = c.getContext('2d');
        g.fillStyle = C.yellow;
        g.fillRect(0, 0, 256, 64);
        g.fillStyle = C.ink;
        for (let i = 0; i < 5; i++) {
          const x = (i + 0.5) * (256 / 5);
          g.beginPath();
          g.moveTo(x - 16, 14); g.lineTo(x + 16, 14); g.lineTo(x, 48);
          g.closePath();
          g.fill();
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();

      const shadowGeo = new THREE.CircleGeometry(1, 24);
      // 한낮의 그림자는 까맣지 않다. 남색으로 옅게 깐다
      const shadowMat = new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0.3, depthWrite: false });
      const M = {
        gold: lit(C.yellow, { metalness: 0.3, roughness: 0.35 }),
        goldRim: lit(C.yellowDark, { metalness: 0.3, roughness: 0.35 }),
        stripes: new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 }),
        white: lit(C.paper),
        beam: lit(C.yellow),
        chevrons: new THREE.MeshStandardMaterial({ map: chevrons, roughness: 0.6 }),
        post: lit(C.blue),
        train: lit(C.red, { roughness: 0.45 }),
        trainTop: lit(C.redLight, { roughness: 0.45 }),
        glass: lit(C.skyMid, { metalness: 0.2, roughness: 0.15 }),
        lamp: new THREE.MeshBasicMaterial({ color: C.lamp }),
      };
      const coinGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.08, 28);
      const coinFaceGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.1, 28);   // 테두리 안쪽 밝은 면

      function box(mat, w, h, d, x, y, z = 0) {
        const m = new THREE.Mesh(unitBox, mat);
        m.scale.set(w, h, d);
        m.position.set(x, y, z);
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
          // 떠 있는 금화는 그림자가 없으면 어느 레인 위에 있는지 헷갈린다
          g.add(shadow(0.3, 0.3));
          // 진한 큰 원반 위에 밝은 작은 원반 — 앞에서 보면 테두리가 둘러진 금화다
          for (const [geo, mat] of [[coinGeo, M.goldRim], [coinFaceGeo, M.gold]]) {
            const disc = new THREE.Mesh(geo, mat);
            disc.rotation.x = Math.PI / 2;   // 납작한 면이 카메라를 본다
            disc.position.y = 1.5;
            g.add(disc);
          }
          return g;
        },
        // 점프 꼭대기(2.2)보다 한참 낮다 — '뛰어넘는다' 로 읽혀야 한다
        barricade() {
          const g = new THREE.Group();
          g.add(shadow(1.1, 0.4), box(M.stripes, 1.7, 1.1, 0.35, 0, 0.55), box(M.white, 1.72, 0.06, 0.37, 0, 1.13));
          return g;
        },
        // 아래 끝 1.2 — 선 키(1.8)보다 낮고 슬라이드 높이(약 0.7)보다 높다.
        // '밑으로 지나가는 문' 으로 읽혀야 한다: 파란 기둥 두 개 사이에 노란 판(가슴 높이)을 걸고,
        // 앞뒤 면에만 ▼ 를 새긴다(윗면까지 새기면 위에서 내려다볼 때 어지럽다)
        beam() {
          const g = new THREE.Group();
          const bar = new THREE.Mesh(unitBox, [M.beam, M.beam, M.beam, M.beam, M.chevrons, M.chevrons]);
          bar.scale.set(1.7, 0.4, 0.3);
          bar.position.y = 1.2 + 0.2;
          g.add(
            shadow(1.0, 0.3),
            bar,
            box(M.post, 0.12, 1.6, 0.12, -0.85, 0.8),
            box(M.post, 0.12, 1.6, 0.12, 0.85, 0.8),
          );
          return g;
        },
        // 넘을 수도 숙일 수도 없다. 레인을 거의 채우는 전철 앞머리라 멀리서도 '막혔다' 로 읽힌다.
        // 깊이는 짧게 둔다 — 충돌은 z 가 러너를 지나는 한 순간만 본다. 길면 판정이 끝난 뒤에도
        // 몸통이 레인에 남아, 옆에서 들어온 러너가 전철을 뚫고 지나가 보인다
        pillar() {
          const g = new THREE.Group();
          const front = 0.61;   // 앞면(+z, 카메라 쪽) 바로 앞
          g.add(
            shadow(1.1, 0.7),
            box(M.train, 2.0, 2.9, 1.2, 0, 1.45),
            box(M.trainTop, 2.0, 0.3, 1.2, 0, 3.05),
            box(M.glass, 1.6, 0.8, 0.04, 0, 2.2, front),
            box(M.lamp, 0.28, 0.2, 0.04, -0.65, 0.7, front),
            box(M.lamp, 0.28, 0.2, 0.04, 0.65, 0.7, front),
          );
          return g;
        },
      };
```

- [ ] **Step 2: `unitEdges` 줄을 지운다**

Task 1 에서 남긴 `const unitEdges = new THREE.EdgesGeometry(unitBox);` 를 지운다 (이제 쓰는 곳이 없다).

- [ ] **Step 3: 러너 재질을 바꾼다**

러너 IIFE 의 앞부분(`const skin = lit(C.mint...` 부터 `const armR = limb(...)` 까지)을 아래로 바꾼다. `limb()` 함수와 그 아래(`blob`, `scene.add`, `return`)는 그대로.

```js
      const runner = (() => {
        // 멀리서도 튀는 옷차림: 노란 모자, 분홍 티, 청바지. 왼쪽 팔다리는 한 톤 어둡게 해 앞뒤가 읽힌다
        const skin = lit(C.skin, { roughness: 0.5 });
        const skinShade = lit(C.skinDark, { roughness: 0.5 });
        const shirt = lit(C.pink);
        const jeans = lit(C.blue, { roughness: 0.7 });
        const jeansShade = lit(C.blueDark, { roughness: 0.7 });
        const root = new THREE.Group();   // 발밑. 슬라이드는 이것을 뒤로 눕힌다
        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 6, 12), shirt);
        torso.position.y = 1.15;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), skin);
        head.position.y = RUNNER_H - 0.2;
        // 모자 — 머리보다 살짝 큰 반구를 정수리에 씌운다
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.215, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), lit(C.yellow));
        cap.position.y = RUNNER_H - 0.17;
        root.add(torso, head, cap);
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
        const legL = limb(-0.12, 0.8, 0.8, 0.1, jeansShade);
        const legR = limb(0.12, 0.8, 0.8, 0.1, jeans);
        const armL = limb(-0.3, 1.45, 0.65, 0.07, skinShade);
        const armR = limb(0.3, 1.45, 0.65, 0.07, skin);
```

- [ ] **Step 4: 러너 그림자를 옅게 한다**

`poseRunner` 안:

```js
        r.blob.material.opacity = 0.35 * near;
```

- [ ] **Step 5: 과도기 팔레트 키를 줄인다**

`C` 의 과도기 줄을 아래 한 줄로 바꾼다 (점수판이 아직 `cyan`, `gold` 를 쓴다):

```js
      // 옛 네온 색 — 점수판을 옮기면 지운다
      cyan: '#4de3ff', gold: '#ffd34d',
```

- [ ] **Step 6: 옛 색이 남지 않았는지 검색**

Run: `grep -nE "C\.(mint|mintDark|ember|emberLight|emberDark|violet|violetDark)\b|unitEdges|M\.(cyan|violet|pillar|emberTop)\b" public/index.html`
Expected: 출력 없음

- [ ] **Step 7: 셀프 테스트 실행**

Run: `node $TMPDIR/selftest.mjs public/index.html`
Expected: `21 / 21 통과`

- [ ] **Step 8: 브라우저 확인 — 한 판 플레이**

시작 → (카메라 거부) → 방향키로 플레이. 스크린샷 3장 이상.
Expected:
- 빨강·흰 줄무늬 바리케이드, 파란 기둥 + 노란 ▼ 판 문, 빨간 전철 앞머리(하늘색 창·전조등 2개), 테두리 있는 금화, 노란 모자·분홍 티·청바지 러너
- `↑` 점프 때 바리케이드 위로 확실히 뜨고, `↓` 슬라이드 때 문 판 밑으로 누워 지나가 보인다
- 전철이 러너를 막 지나간 직후 그 레인으로 옮겨도 전철 몸통을 뚫고 지나가 보이지 않는다
- 콘솔 오류 없음

- [ ] **Step 9: 커밋**

```bash
git add public/index.html
git commit -m "장애물을 공사 줄무늬·노란 문·빨간 전철로, 러너를 모자·티·청바지 차림으로 바꿈

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 점수판 카드와 비네트

**Files:**
- Modify: `public/index.html` — `drawHud`/`drawVignette`(1182-1238행 근처), 팔레트 과도기 줄, `runSelfTests` 끝(`return results;` 바로 위)

**Interfaces:**
- Consumes: `C.paper ink inkDim lineSoft yellow yellowDark`, `speedGauge(sp)`, `DISPLAY_FONT`
- Produces: `const HUD_MIN_W = 220`, `hudCardWidth(scoreTextW: number): number` — 점수 글자 폭(px)을 받아 카드 폭(px)을 돌려준다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`runSelfTests` 안, `return results;` 바로 위에 넣는다:

```js
      check('점수판 카드는 점수가 아무리 길어도 글자를 다 담는다', () => {
        // 속도에 상한이 없으니 점수 자릿수에도 끝이 없다. 카드가 고정 폭이면 언젠가 숫자가 삐져나간다
        assert(hudCardWidth(0) === HUD_MIN_W, `빈 점수인데 카드 폭 ${hudCardWidth(0)} (기대 ${HUD_MIN_W})`);
        const wide = 9 * 25;   // 42px 헤비 서체 숫자 한 자는 약 25px — 9자리
        const need = wide + 16 * 2 + 23;   // 안쪽 여백 양쪽 + '점' 과 그 앞 간격
        assert(hudCardWidth(wide) >= need, `점수 폭 ${wide} 인데 카드 폭 ${hudCardWidth(wide)} — ${need} 는 돼야 한다`);
      });
```

- [ ] **Step 2: 실패 확인**

Run: `node $TMPDIR/selftest.mjs public/index.html`
Expected: `FAIL 점수판 카드는 점수가 아무리 길어도 글자를 다 담는다 — hudCardWidth is not defined`, `21 / 22 통과`

- [ ] **Step 3: `drawHud` 를 바꾸고 `hudCardWidth` 를 더한다**

`// ── 점수판 — 3D 위에 얹은 #hud 캔버스에 그린다` 줄부터 `drawHud` 끝까지를 아래로 바꾼다:

```js
    // ── 점수판 — 3D 위에 얹은 #hud 캔버스에 그린다. 밝은 하늘 위에서도 읽히도록 흰 스티커 카드 위에 쓴다
    // 카드 폭. 속도에 상한이 없어 점수 자릿수도 끝이 없다 — 카드가 글자를 따라 늘어난다
    const HUD_MIN_W = 220;   // 속도 막대(132) + 단계 글자 + 안쪽 여백이 들어가는 폭
    function hudCardWidth(scoreTextW) {
      return Math.max(HUD_MIN_W, Math.ceil(scoreTextW) + 64);
    }

    function drawHud(ctx, v) {
      const pad = 20, inner = 16;
      const score = String(v.score);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `400 42px ${DISPLAY_FONT}`;
      const scoreW = ctx.measureText(score).width;
      const cardW = hudCardWidth(scoreW), cardH = 112;

      // 카드 — 아래로 떨어진 남색 두께가 메뉴의 스티커 카드와 같은 모양을 만든다
      ctx.fillStyle = 'rgba(29, 43, 83, 0.22)';
      ctx.beginPath();
      ctx.roundRect(pad, pad + 5, cardW, cardH, 18);
      ctx.fill();
      ctx.fillStyle = C.paper;
      ctx.beginPath();
      ctx.roundRect(pad, pad, cardW, cardH, 18);
      ctx.fill();

      const x = pad + inner;
      ctx.fillStyle = C.ink;
      ctx.fillText(score, x, pad + 50);
      ctx.fillStyle = C.inkDim;
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillText('점', x + scoreW + 7, pad + 50);

      // 속도 게이지 — 막대는 한 단계분, 숫자는 몇 단계인지
      const barY = pad + 66;
      const gauge = speedGauge(v.speed);
      ctx.fillStyle = C.lineSoft;
      ctx.beginPath();
      ctx.roundRect(x, barY, 132, 6, 3);
      ctx.fill();
      if (gauge.fill > 0) {
        ctx.fillStyle = C.yellow;
        ctx.beginPath();
        ctx.roundRect(x, barY, 132 * gauge.fill, 6, 3);
        ctx.fill();
      }
      ctx.textBaseline = 'middle';
      ctx.fillStyle = C.inkDim;
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(`${gauge.level}단계`, x + 142, barY + 3);

      // 코인 — 아이콘도 화면 안의 금화와 같은 모양(진한 테두리 + 밝은 면)이다
      const cy = barY + 26;
      ctx.fillStyle = C.yellowDark;
      ctx.beginPath();
      ctx.arc(x + 7, cy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.yellow;
      ctx.beginPath();
      ctx.arc(x + 7, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.inkDim;
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText(String(v.coins), x + 20, cy + 1);
      ctx.textBaseline = 'alphabetic';
    }
```

- [ ] **Step 4: 비네트 색을 바꾼다**

`drawVignette` 의 두 `addColorStop` 을:

```js
        // 밝은 한낮이라 검게 누르면 흙탕물처럼 보인다. 남색으로 옅게만 좁힌다
        g.addColorStop(0, 'rgba(29, 43, 83, 0)');
        g.addColorStop(1, 'rgba(29, 43, 83, 0.4)');
```

- [ ] **Step 5: 과도기 키를 지운다**

`C` 에서 `// 옛 네온 색 — 점수판을 옮기면 지운다` 줄과 `cyan: '#4de3ff', gold: '#ffd34d',` 줄을 지운다.

Run: `grep -nE "C\.(cyan|gold|mint|ember|violet)" public/index.html`
Expected: 출력 없음

- [ ] **Step 6: 테스트 통과 확인**

Run: `node $TMPDIR/selftest.mjs public/index.html`
Expected: `22 / 22 통과`

- [ ] **Step 7: 브라우저 확인**

한 판 플레이하며 스크린샷. Expected: 왼쪽 위 흰 둥근 카드 안에 남색 점수 + `점`, 노란 속도 막대 + `N단계`, 금화 아이콘 + 코인 수. 카드 아래로 남색 두께. 속도가 올라도 가장자리가 검게 뭉개지지 않는다. 콘솔 오류 없음.

- [ ] **Step 8: 커밋**

```bash
git add public/index.html
git commit -m "점수판을 흰 스티커 카드로 바꾸고 비네트를 옅은 남색으로 바꿈

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 메뉴 화면 CSS 와 팔레트 짝 맞추기 테스트

**Files:**
- Modify: `public/index.html` — `<head>` 의 서체 주석(8-9행), `<style>` 전체(22-316행 근처), `runSelfTests` 끝, `renderSelfTests` 의 PASS/FAIL 색

**Interfaces:**
- Consumes: Task 1~3 이 완성한 `C` (과도기 키 없음)
- Produces: CSS 변수 `--sky-top --sky-mid --sky-horizon --grass --ink --ink-dim --ink-faint --paper --line --line-soft --yellow --yellow-dark --stripe-red --green` (모두 `C` 와 같은 값), `--shade`(rgba, 짝 없음)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`runSelfTests` 안, `return results;` 바로 위에 넣는다:

```js
      check('CSS :root 의 색과 스크립트 팔레트 C 가 같다', () => {
        // 메뉴는 CSS 로, 3D 세상과 점수판은 C 로 칠한다. 한쪽만 바꾸면 화면이 둘로 갈라진다.
        // --kebab-case 이름을 camelCase 로 바꿔 짝짓는다 (--ink-dim ↔ C.inkDim)
        const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
        const root = css.match(/:root\s*\{([^}]*)\}/)[1];
        const pairs = [...root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)];
        assert(pairs.length >= 10, `:root 에서 색을 ${pairs.length}개만 찾았다`);
        for (const [, name, hex] of pairs) {
          const key = name.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
          assert(C[key]?.toLowerCase() === hex.toLowerCase(), `--${name} 는 ${hex} 인데 C.${key} 는 ${C[key]}`);
        }
      });
```

- [ ] **Step 2: 실패 확인**

Run: `node $TMPDIR/selftest.mjs public/index.html`
Expected: `FAIL CSS :root 의 색과 스크립트 팔레트 C 가 같다 — --void 는 #05070f 인데 C.void 는 undefined`, `22 / 23 통과`

- [ ] **Step 3: 서체 주석을 고친다**

```html
  <!-- 표제용 서체. 스티커 글씨는 획이 굵어야 테두리가 살아서 한글까지 덮는 헤비 페이스를 쓴다.
       못 받아오면 시스템 고딕으로 떨어질 뿐 화면은 그대로 돈다 -->
```

- [ ] **Step 4: `<style>` 안을 통째로 바꾼다**

`<style>` 과 `</style>` 사이 전부를 아래로 바꾼다. 배치(크기·간격·그리드)는 지금과 같고 색·테두리·그림자만 다르다.

```css
    /* ── 세계관 토큰 — 한낮의 팝 도시: 파란 하늘, 흰 스티커 카드, 노란 버튼, 남색 글씨.
       캔버스도 같은 값을 쓴다 (아래 "── 팔레트" 섹션의 C 와 짝을 맞춘다 — 셀프 테스트가 지킨다) */
    :root {
      --sky-top: #4fb8ff;
      --sky-mid: #bfe9ff;
      --sky-horizon: #fff4c9;
      --grass: #8fd16a;
      --ink: #1d2b53;
      --ink-dim: #4a5b88;
      --ink-faint: #5f6f9c;
      --paper: #ffffff;
      --line: #d7def0;
      --line-soft: #e6ebf7;
      --yellow: #ffcc00;
      --yellow-dark: #d99a00;
      --stripe-red: #ff4d4d;
      --green: #2fbf71;
      --shade: rgba(29, 43, 83, 0.18);   /* 스티커 아래로 떨어진 두께 */
      --r: 14px;
      --ease: cubic-bezier(0.16, 1, 0.3, 1);
      --display: 'Black Han Sans', 'Apple SD Gothic Neo', system-ui, sans-serif;
      color-scheme: light;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0; background: var(--sky-mid); color: var(--ink);
      font-family: system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* 브라우저가 기본으로 그려주는 것들도 이 세계에 속한다 */
    ::selection { background: rgba(255, 204, 0, 0.45); color: var(--ink); }
    :focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }

    #stage { position: relative; width: 100vw; height: 100dvh; }
    #canvas { display: block; width: 100%; height: 100%; }
    /* 3D 캔버스 위에 얹는 투명 층. 점수판과 비네트만 그린다. 클릭은 아래로 통과시킨다 */
    #hud { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

    /* ── 카메라 미리보기 — 흰 테두리를 둘러 사진 스티커처럼 붙인다 */
    #cam {
      position: absolute; right: 18px; bottom: 18px; z-index: 1;
      width: 200px; border-radius: 14px; overflow: hidden; line-height: 0;
      border: 4px solid var(--paper);
      box-shadow: 0 6px 0 var(--shade), 0 14px 30px rgba(29, 43, 83, 0.25);
      background: #05070f;   /* 졸라맨 화면 바탕. 준비 화면 그림은 바꾸지 않는다 */
    }
    /* 영상은 포즈 인식의 입력일 뿐 화면에는 내지 않는다. 자리는 차지해야 미리보기 크기가
       영상 비율을 따라온다 (display:none 은 안 된다 — 크기가 0 이 된다) */
    #preview { display: block; width: 100%; visibility: hidden; }
    /* 준비 화면에서는 미리보기가 가운데로 나와 커진다. 2m 뒤에서도 선과 점이 읽혀야 한다.
       .screen(z 3) 위에 올라와야 그 흐림 처리에 가려지지 않는다 */
    #cam.align {
      right: auto; bottom: auto; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      width: auto; z-index: 4;
    }
    /* 높이로 맞추고 폭은 비율을 따른다. 좁은 창에서는 max-width 가 비율을 지키며 줄인다 */
    #cam.align #preview { width: auto; height: 62vh; max-width: 88vw; }
    /* 오버레이가 곧 미리보기다. 졸라맨은 x 를 1 - x 로 그려 거울처럼 보인다 —
       캔버스에 scaleX(-1) 을 걸면 글자까지 뒤집힌다 */
    #overlay { position: absolute; inset: 0; width: 100%; height: 100%; }

    /* ── 디버그 패널 — 튜닝 도구다. 꾸미지 않고 읽히기만 하면 된다.
       본문 글자가 남색이라 어두운 패널 위에서는 글자색을 따로 밝혀야 한다 */
    #debug {
      position: absolute; left: 18px; bottom: 18px; z-index: 1;
      width: 260px; padding: 12px 14px; border-radius: 12px;
      background: rgba(8, 12, 26, 0.88); border: 1px solid rgba(125, 214, 255, 0.16);
      color: #eaf1ff;
      font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    #debug h3 { margin: 0 0 8px; font-size: 12px; letter-spacing: 0.04em; }
    #debug label { display: block; margin-top: 8px; }
    #debug input[type=range] { width: 100%; accent-color: #4de3ff; }
    #debug .row { display: flex; justify-content: space-between; }

    /* ── 경고 배너 — 지금 조작이 안 먹는 이유를 알려주는 유일한 통로다.
       시작 화면(.screen)보다 위에 둔다 — 3D 를 못 불러온 이유는 시작 화면에서 읽혀야 한다 */
    #banner {
      position: absolute; top: 20px; left: 50%; z-index: 5;
      transform: translateX(-50%);
      padding: 10px 20px; border-radius: 999px;
      background: var(--paper);
      border: 3px solid var(--stripe-red);
      color: #c22222;   /* 흰 바탕 대비 5.9:1 */
      box-shadow: 0 4px 0 rgba(255, 77, 77, 0.3);
      font-size: 14px; font-weight: 700; display: none;
      animation: drop 0.32s var(--ease);
    }
    @keyframes drop { from { opacity: 0; transform: translate(-50%, -14px); } }

    #toast {
      position: absolute; bottom: 26px; left: 50%; z-index: 2;
      transform: translateX(-50%);
      padding: 11px 20px; border-radius: 999px; font-size: 14px; font-weight: 600;
      background: var(--paper); border: 2px solid var(--line);
      color: var(--ink); display: none;
      box-shadow: 0 4px 0 var(--shade);
      animation: rise 0.32s var(--ease);
    }
    @keyframes rise { from { opacity: 0; transform: translate(-50%, 14px); } }

    /* ── 화면 — 캔버스 위에 덮인다. 뒤의 하늘과 선로가 비쳐야 게임 안에 있는 느낌이 산다 */
    .screen {
      position: absolute; inset: 0; z-index: 3;
      display: flex; align-items: center; justify-content: center;
      padding: 28px; overflow: auto;
      background:
        radial-gradient(120% 90% at 50% 0%, rgba(255, 255, 255, 0.55), transparent 60%),
        rgba(191, 233, 255, 0.45);
      backdrop-filter: blur(6px) saturate(1.1);
    }
    .hidden { display: none !important; }

    /* 스티커 카드 — 흰 종이에 아래로 떨어진 두께 */
    .panel {
      width: min(880px, 100%);
      padding: 34px;
      border-radius: 24px;
      background: var(--paper);
      box-shadow: 0 8px 0 var(--shade), 0 24px 50px rgba(29, 43, 83, 0.18);
      animation: enter 0.5s var(--ease);
    }
    @keyframes enter { from { opacity: 0; transform: translateY(18px) scale(0.985); } }

    .title {
      margin: 0;
      font-family: var(--display);
      font-size: clamp(44px, 8vw, 76px);
      font-weight: 400;
      line-height: 0.95;
      letter-spacing: -0.01em;
      color: var(--yellow);
      /* 스티커 글씨 — 남색 테두리를 글자 뒤에 칠하고(paint-order) 아래로 두께를 떨어뜨린다 */
      -webkit-text-stroke: 3px var(--ink);
      paint-order: stroke fill;
      text-shadow: 0 6px 0 var(--ink);
    }

    .lede { margin: 0; color: var(--ink-dim); line-height: 1.75; font-size: 15px; }
    .lede.dim { color: var(--ink-faint); font-size: 13px; }

    /* ── 시작 화면 — 넓으면 좌우로, 좁으면 위아래로 */
    .start-panel {
      display: grid; gap: 34px;
      grid-template-columns: 1fr;
    }
    @media (min-width: 760px) {
      .start-panel { grid-template-columns: 1.15fr 0.85fr; align-items: start; }
      .start-rank { border-left: 2px dashed var(--line-soft); padding-left: 34px; }
    }
    .start-main { display: flex; flex-direction: column; gap: 18px; }

    .field { display: flex; gap: 10px; margin-top: 4px; }
    #nickname {
      flex: 1; min-width: 0;
      padding: 14px 16px; font-size: 16px;
      border-radius: var(--r);
      border: 3px solid var(--line);
      background: #f6f8ff;
      color: var(--ink);
      caret-color: var(--ink);
      transition: border-color 0.2s var(--ease), background 0.2s var(--ease);
    }
    #nickname::placeholder { color: var(--ink-faint); }
    #nickname:focus {
      outline: none;
      border-color: var(--ink);
      background: var(--paper);
    }
    #nickname:focus-visible { outline: 3px solid var(--yellow); outline-offset: 2px; }

    /* 두툼한 스티커 버튼 — 누르면 아래 두께만큼 내려간다 */
    button {
      padding: 14px 30px; font-size: 17px; font-weight: 800; cursor: pointer;
      border-radius: var(--r); border: 0;
      background: var(--yellow); color: #3a2300;   /* 노랑 위 대비 9.8:1 */
      font-family: inherit;
      box-shadow: 0 5px 0 var(--yellow-dark);
      transition: transform 0.12s var(--ease), box-shadow 0.12s var(--ease), filter 0.18s var(--ease);
    }
    button:hover { filter: brightness(1.05); }
    button:active { transform: translateY(5px); box-shadow: 0 0 0 var(--yellow-dark); }
    button:disabled { opacity: 0.45; cursor: not-allowed; transform: none; filter: none; }

    /* ── 조작 안내 — 키에 적힌 글자를 키 모양 그대로 보여준다 */
    .keys { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 9px; }
    .keys li {
      display: flex; align-items: center; gap: 10px;
      font-size: 13px; color: var(--ink-dim);
    }
    .cap {
      min-width: 26px; height: 26px; padding: 0 7px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 7px;
      border: 2px solid var(--line);
      border-bottom-width: 4px;
      background: var(--paper);
      color: var(--ink);
      font-size: 12px; font-weight: 700;
    }

    /* ── 랭킹 */
    .start-rank h2 {
      margin: 0 0 14px;
      font-size: 13px; font-weight: 700;
      letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--ink-faint);
    }
    #ranking { list-style: none; padding: 0; margin: 0; max-height: 470px; overflow-y: auto; }
    #ranking li {
      display: grid; grid-template-columns: 26px 1fr auto;
      align-items: center; gap: 10px;
      padding: 9px 2px;
      border-bottom: 2px dashed var(--line-soft);
      font-size: 14px;
    }
    #ranking li:last-child { border-bottom: 0; }
    /* 등수 — 1·2·3 등은 금·은·동 메달, 나머지는 숫자만 */
    .rk {
      width: 24px; height: 24px; border-radius: 50%;
      display: grid; place-items: center;
      font-size: 12px; font-weight: 800; color: var(--ink-faint);
    }
    .rk-1 { background: var(--yellow); color: #3a2300; }
    .rk-2 { background: #b8c4dc; color: var(--ink); }
    .rk-3 { background: #e0925a; color: #3a1a00; }
    .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sc { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--ink); }
    /* 안내 문구는 등수 칸에 들어갈 것이 아니다. 격자를 벗어나 한 줄로 흐른다 */
    #ranking li.rank-note {
      display: block; border-bottom: 0;
      color: var(--ink-faint); font-size: 13px; padding: 9px 2px;
    }
    #ranking::-webkit-scrollbar { width: 6px; }
    #ranking::-webkit-scrollbar-thumb { background: var(--line); border-radius: 3px; }
    #ranking::-webkit-scrollbar-track { background: transparent; }

    /* ── 준비 화면 — 안내 문구는 위, 남은 시간은 아래. 가운데는 카메라(#cam.align)가 차지한다.
       뒤가 밝은 하늘이라 흰 글씨에 남색 테두리를 둘러야 읽힌다 */
    #countdown { flex-direction: column; justify-content: space-between; }
    .align-msg {
      margin: 0; text-align: center;
      font-size: clamp(17px, 2.6vh, 23px); font-weight: 800; color: #fff;
      -webkit-text-stroke: 5px var(--ink);
      paint-order: stroke fill;
    }
    .ring { position: relative; display: grid; place-items: center; width: 116px; height: 116px; }
    .ring-track {
      position: absolute; inset: 0; border-radius: 50%;
      background: conic-gradient(
        from -90deg,
        var(--yellow) calc(var(--p, 1) * 360deg),
        rgba(255, 255, 255, 0.6) 0
      );
      -webkit-mask: radial-gradient(circle, transparent 50px, #000 51px);
              mask: radial-gradient(circle, transparent 50px, #000 51px);
      filter: drop-shadow(0 4px 0 var(--shade));
    }
    #count {
      position: relative;
      font-family: var(--display); font-weight: 400;
      font-size: 54px; line-height: 1; color: #fff;
      font-variant-numeric: tabular-nums;
      -webkit-text-stroke: 3px var(--ink);
      paint-order: stroke fill;
      text-shadow: 0 5px 0 var(--ink);
    }

    /* ── 결과 화면 */
    .over-panel {
      width: min(460px, 100%);
      display: flex; flex-direction: column; align-items: center; gap: 18px;
      text-align: center;
    }
    .score-big {
      margin: 0;
      font-family: var(--display); font-weight: 400;
      font-size: clamp(64px, 14vw, 104px); line-height: 1; color: #fff;
      font-variant-numeric: tabular-nums;
      -webkit-text-stroke: 3px var(--ink);
      paint-order: stroke fill;
      text-shadow: 0 6px 0 var(--ink);
    }
    .score-big .unit {
      font-size: 0.34em; color: var(--ink-dim); margin-left: 0.22em;
      -webkit-text-stroke: 0; text-shadow: none;
    }
    .status { margin: 0; display: flex; align-items: center; gap: 9px; font-size: 14px; color: var(--ink-dim); }
    .status::before {
      content: ''; width: 9px; height: 9px; border-radius: 50%;
      background: var(--ink-faint); flex: none;
    }
    .status.ok::before { background: var(--green); }
    .status.bad::before { background: var(--stripe-red); }
    /* 2.5초 뒤 시작 화면으로 돌아간다. 얼마나 남았는지 보여준다 */
    .restart-bar { width: 150px; height: 6px; background: var(--line-soft); border-radius: 3px; overflow: hidden; }
    .restart-bar i { display: block; height: 100%; background: var(--yellow); transform-origin: left; }
    .restart-bar.run i { animation: drain 2.5s linear forwards; }
    @keyframes drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }

    /* 움직임에 민감한 사용자에게는 연출을 걷어낸다. 게임 자체는 내용이라 남긴다 */
    @media (prefers-reduced-motion: reduce) {
      .panel, #banner, #toast { animation: none; }
      .restart-bar.run i { animation: none; transform: scaleX(0); }
      button { transition: none; }
    }
```

- [ ] **Step 5: 셀프 테스트 결과 화면 색을 밝은 바탕에 맞춘다**

`renderSelfTests` 의 한 줄:

```js
        .map((r) => `<li style="color:${r.ok ? '#1f8a4c' : '#c22222'}">
```

- [ ] **Step 6: 테스트 통과 확인 + 옛 변수 검색**

Run: `node $TMPDIR/selftest.mjs public/index.html && grep -nE "var\(--(cyan|mint|gold|ember|violet|void|deep|panel|edge)" public/index.html`
Expected: `23 / 23 통과`, grep 출력 없음

- [ ] **Step 7: 브라우저 확인 — 메뉴 4화면 + 배너 + 디버그**

스크린샷을 각각 찍는다.
1. 시작 화면: 흰 카드, 노란 글씨·남색 테두리 제목, 노란 버튼(아래 두께), 키 모양 안내, 랭킹 1·2·3 메달. 시안 `ui-design-v2.html` 과 같은 분위기
2. 시작 → 준비 화면: 흰 글씨+남색 테두리 안내 문구, 노란 링, 카운트 숫자
3. 게임 오버: 흰+남색 테두리 큰 점수, 상태 점(초록/빨강), 노란 되돌아가기 막대
4. `D` 키: 디버그 패널 글자가 어두운 바탕 위에서 밝게 읽힌다 (Review Focus 5)
5. **3D 로드 실패**: `public/index.html` 의 importmap `three` 주소를 잠시 `https://cdn.jsdelivr.net/npm/three@0.0.0-nope/build/three.module.js` 로 바꾸고 새로고침 → 시작 버튼이 흐리게 막혀 있고, 빨간 테두리 흰 배너 "3D 화면을 불러오지 못했습니다…" 가 시작 카드 위에 또렷이 보인다. 스크린샷 후 **주소를 원래대로 되돌린다**. (Review Focus 1)

Run: `git diff --stat` — importmap 주소가 원래대로인지 `grep -n "three@0.186.1" public/index.html` 로 확인
Expected: `three@0.186.1` 한 줄

- [ ] **Step 8: 커밋**

```bash
git add public/index.html
git commit -m "메뉴 화면을 흰 스티커 카드·노란 버튼으로 바꾸고 CSS·캔버스 색이 같은지 셀프 테스트로 지킴

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 전체 점검

**Files:**
- 코드 변경 없음 (문제가 나오면 해당 Task 의 코드로 돌아가 고치고 그 Task 의 확인을 다시 한다)

- [ ] **Step 1: 테스트 전부**

Run: `node $TMPDIR/selftest.mjs public/index.html && npm test`
Expected: `23 / 23 통과`, `pass 6`

- [ ] **Step 2: 옛 네온 흔적 검색**

Run: `grep -nE "#4de3ff|#7ef6a0|#b06dff|#ff6a4d|neon|네온|bloom|발광" public/index.html README.md`
Expected: 디버그 패널의 `#4de3ff`(accent-color) 한 줄과, 카메라 오버레이 `render(lm, ...)` 안의 `#7ef6a0` 두 줄(정렬 표시·점프 기준선 — 준비 화면 그림은 그대로 둔다) 외에는 없음. 주석에 "네온" 이 남아 있으면 새 세계 설명으로 고친다

- [ ] **Step 3: 한 판 끝까지 (1280×720)**

시작 → 준비 화면 → 방향키로 최소 40초 플레이(속도 3단계 이상) → 게임 오버 → 2.5초 뒤 시작 화면 복귀. 콘솔 오류 없음. 방금 점수가 랭킹에 보인다.

- [ ] **Step 4: 좁은 화면 (Review Focus 3)**

창 폭 390px(휴대폰 세로)로 줄이고 시작 화면 스크린샷.
Expected: 카드가 위아래로 쌓이고(랭킹이 아래로), 제목 테두리·그림자가 잘리지 않으며, 가로 스크롤이 없다.

- [ ] **Step 5: 12자 닉네임 랭킹 (Review Focus 4)**

```bash
curl -s -X POST http://localhost:8787/api/scores/ -H 'content-type: application/json' \
  -d '{"nickname":"가나다라마바사아자차카타","score":99999}'
```

시작 화면을 새로고침해 스크린샷.
Expected: 1등 메달 옆 닉네임이 말줄임(…)으로 줄고, 점수 칸이 밀려나지 않는다.
확인 후 `/admin` 에서 이 기록을 지운다 (`.dev.vars` 의 아이디/비밀번호).

- [ ] **Step 6: 마무리 보고**

스크린샷(시작·준비·게임 중·게임 오버·좁은 화면)과 테스트 결과를 사용자에게 보여준다.
