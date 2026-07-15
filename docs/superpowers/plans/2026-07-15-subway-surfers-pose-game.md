# 포즈 조작 Subway Surfers 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노트북 카메라로 몸을 추적해 조작하는 3레인 엔드리스 러너를 로컬에서 동작시킨다.

**Architecture:** Django가 단일 `index.html`을 서빙하고 Google Sheets 랭킹 API 2개를 제공한다. 프론트는 한 파일 안에서 PoseTracker(카메라·MediaPipe) → InputMapper(랜드마크→조작신호) → Game(상태·렌더)의 단방향 파이프라인으로 나뉜다. Game은 포즈를 모르므로 키보드로 동일한 신호를 주입할 수 있고, 이것이 카메라 없이 개발·테스트하는 유일한 수단이다.

**Tech Stack:** Django 6.0.7, gspread 6.2.1, pytest 9.1.1 + pytest-django 4.12.0, Python 3.14.4, MediaPipe tasks-vision 0.10.35 (CDN ESM), Canvas 2D

**설계 문서:** `docs/superpowers/specs/2026-07-15-subway-surfers-pose-game-design.md`

---

## Global Constraints

- 새로 만드는 모든 소스 파일의 첫 줄은 역할을 설명하는 한국어 한 줄 주석이다. 설정 파일(`pytest.ini`, `requirements.txt`)은 제외한다.
- 프론트엔드에서 직접 작성하는 코드는 전부 `game/templates/index.html` 안에 있다. 별도 `.js` / `.css` 파일로 쪼개지 않는다. MediaPipe만 CDN에서 불러온다.
- MediaPipe 버전은 **0.10.35로 고정**한다. JS와 WASM 경로 모두 같은 버전을 박는다. `@latest`는 JS/WASM 버전 스큐 위험이 있어 쓰지 않는다.
- MediaPipe는 **ESM 전용이다. UMD 빌드가 존재하지 않는다.** `<script src=".../vision_bundle.mjs">` 형태는 `SyntaxError`가 나며 전역을 만들지 않는다. 공식 문서의 해당 예제는 오류다.
- MediaPipe는 반드시 **동적 `import()`를 try/catch로 감싸서** 불러온다. 정적 `import`는 CDN 실패 시 모듈 전체 실행이 중단되어 키보드 폴백까지 죽는다.
- `detectForVideo(video, timestampMs)`의 **타임스탬프는 필수다.** 공식 문서의 `detectForVideo(video)` 예제는 오류다. 동기로 결과를 반환한다.
- 랜드마크의 `visibility`는 **채워진다** (v0.10.11+, PR #5142). 실측 0.941~0.99999. 대체 수단을 만들지 않는다. `presence`는 JS API에 **없다.** 참조하지 않는다.
- 서버 사이드 점수 검증은 하지 않는다. 닉네임 길이(1~12자)와 점수 정수 검증만 둔다. 의도적 생략이다.
- 시트는 부가 기능이고 게임이 본체다. 시트 오류가 게임을 죽이지 않는다.
- 한국어 문장은 마침표로 끝낸다. 콜론으로 끝내지 않는다.

## 좌표계 규약 (전 태스크 공통)

- MediaPipe의 x, y는 0~1 정규화이고 **y는 아래로 갈수록 커진다.** 위로 올라감 = y 감소.
- 화면 좌우와 사용자 좌우를 맞추려면 `laneX = 1 - x`로 미러링하고, 프리뷰에도 CSS `transform: scaleX(-1)`을 건다.
- 부호 반전이 이 코드에서 가장 흔한 버그다. 변수명에 방향을 명시한다.

## 인터페이스 계약 — jump/slide는 상태가 아니라 엣지 이벤트다

InputMapper가 내보내는 `jump` / `slide`는 **트리거된 그 한 프레임에만 `true`** 다. 600ms 애니메이션의 소유자는 Game이고, 900ms 불응기(애니메이션 600 + 잠금 300)의 소유자는 InputMapper다.

이 분리를 지키는 이유가 있다. 설계 문서의 셀프 테스트 기준이 "jump가 **정확히 1회 발화**한다"이므로 상태 방식이면 여러 프레임 `true`가 되어 셀 수 없다. 또한 Game이 애니메이션 길이를 소유해야 InputMapper의 타이밍 상수와 게임 연출이 서로 얽히지 않는다. 키보드 소스도 동일한 엣지 의미를 따른다.

## File Structure

```
weniv_project/
├── manage.py                    # Django 진입점
├── requirements.txt
├── pytest.ini
├── checklist.md                 # 태스크 단위 진행 추적
├── context-notes.md             # 구현 중 결정과 근거
├── credentials.json             # 서비스 계정 키. git 제외 (직접 발급)
├── config/
│   ├── __init__.py
│   ├── settings.py              # DB 없는 최소 설정
│   ├── urls.py                  # 루트 라우팅
│   └── wsgi.py
└── game/
    ├── __init__.py
    ├── urls.py                  # / 와 /api/scores/
    ├── views.py                 # index 렌더 + 랭킹 조회/등록
    ├── sheets.py                # gspread 래퍼. 여기만 시트를 안다
    ├── templates/
    │   └── index.html           # 프론트 전부
    └── tests/
        ├── __init__.py
        └── test_api.py          # gspread 모킹
```

`index.html`은 한 파일이지만 아래 마커 순서로 구성한다. 각 태스크는 자기 마커 자리에만 코드를 넣는다.

```html
<!doctype html>
<html lang="ko">
<head> … <style> … </style> </head>
<body>
  <!-- DOM: 시작화면 / 카운트다운 / 캔버스 / 프리뷰 / 디버그패널 -->
  <script type="module">
    // ── 상수·랜드마크 인덱스·공용 헬퍼   (Task 3)
    // ── InputMapper                      (Task 3)
    // ── 셀프 테스트 (?test=1)            (Task 3)
    // ── Game                             (Task 4)
    // ── 키보드 소스                      (Task 4)
    // ── PoseTracker                      (Task 5)
    // ── 디버그 패널                      (Task 5)
    // ── 화면 전환·API·부트               (Task 6)
  </script>
</body>
</html>
```

## 태스크 순서와 근거

각 태스크는 독립적으로 테스트 가능한 산출물로 끝난다. 순서는 "카메라 앞에 서지 않고 검증 가능한 것부터"다.

| # | 태스크 | 끝났을 때 확인 가능한 것 |
|---|---|---|
| 1 | Django 스캐폴드 + index 서빙 | `GET /`가 HTML 200을 준다 |
| 2 | Sheets 래퍼 + 랭킹 API | 모킹된 pytest로 GET/POST가 통과한다 |
| 3 | InputMapper + `?test=1` | 카메라 없이 판정 로직 6케이스가 통과한다 |
| 4 | Game 엔진 + 키보드 모드 | 화살표 키로 실제 플레이가 된다 |
| 5 | PoseTracker + 디버그 패널 | 몸으로 조작되고 임계값을 실시간 튜닝한다 |
| 6 | 화면 전환 + 점수 연동 | 닉네임→카운트다운→플레이→랭킹 등록 전체가 돈다 |

---

### Task 1: Django 스캐폴드 + index 서빙 + 프로젝트 문서

**Files:**
- Create: `requirements.txt`, `pytest.ini`, `manage.py`, `checklist.md`, `context-notes.md`
- Create: `config/__init__.py`, `config/settings.py`, `config/urls.py`, `config/wsgi.py`
- Create: `game/__init__.py`, `game/urls.py`, `game/views.py`, `game/templates/index.html`
- Create: `game/tests/__init__.py`, `game/tests/test_api.py`

**Interfaces:**
- Consumes: 없음
- Produces: `game.views.index(request)` → `index.html` 렌더. `config.settings`에 `GOOGLE_CREDENTIALS: str`, `SHEET_ID: str` 설정 상수 (Task 2가 읽는다)

- [ ] **Step 1: 가상환경과 의존성 설치**

```bash
cd /Users/munhokang/82107/weniv_project
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
```

`requirements.txt` — Python 3.14에서 설치·import 검증된 버전이다.

```
Django==6.0.7
gspread==6.2.1
pytest==9.1.1
pytest-django==4.12.0
```

```bash
.venv/bin/pip install -r requirements.txt
.venv/bin/python -c "import django, gspread; print(django.get_version(), gspread.__version__)"
```

Expected: `6.0.7 6.2.1`

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`game/tests/test_api.py`

```python
# 랭킹 API와 index 서빙에 대한 테스트. gspread는 모킹한다
def test_index_returns_html(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"<canvas" in response.content


def test_index_embeds_csrf_token(client):
    response = client.get("/")
    assert b'name="csrf-token"' in response.content
    assert b'content=""' not in response.content
```

`game/tests/__init__.py` — 빈 파일.

`pytest.ini` — `pythonpath = .`이 없으면 pytest-django가 설정 모듈을 못 찾는다. 실측으로 확인한 사항이다.

```ini
[pytest]
DJANGO_SETTINGS_MODULE = config.settings
pythonpath = .
python_files = test_*.py
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `.venv/bin/pytest -q`
Expected: FAIL — `ImportError: No module named 'config'`에 이어
`pytest-django could not find a Django project`. pytest-django 가 자체 래퍼에서
`ImportError`로 바꿔 던지므로 `ModuleNotFoundError`가 아니다.

- [ ] **Step 4: 스캐폴드를 작성한다**

`manage.py`

```python
#!/usr/bin/env python
# Django 관리 명령 진입점
import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
```

`config/__init__.py`, `game/__init__.py` — 빈 파일.

`config/settings.py` — DB를 쓰지 않으므로 `DATABASES = {}`로 둔다. 실측으로 부팅과 테스트 통과를 확인했다.

```python
# 로컬 전용 Django 최소 설정. DB를 쓰지 않고 시트만 사용한다
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = "local-dev-only-not-a-secret"
DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "game",
]

MIDDLEWARE = [
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.csrf",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# 시트를 쓰지 않으므로 DB는 비운다
DATABASES = {}

STATIC_URL = "static/"
USE_TZ = True
TIME_ZONE = "Asia/Seoul"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Google Sheets. 실제 값은 환경변수로 주입한다
GOOGLE_CREDENTIALS = os.environ.get(
    "GOOGLE_CREDENTIALS", str(BASE_DIR / "credentials.json")
)
SHEET_ID = os.environ.get("SHEET_ID", "")
```

`config/urls.py`

```python
# 루트 URL 라우팅
from django.urls import include, path

urlpatterns = [
    path("", include("game.urls")),
]
```

`config/wsgi.py`

```python
# WSGI 진입점
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_wsgi_application()
```

`game/urls.py`

```python
# 게임 앱 URL 라우팅
from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
]
```

`game/views.py`

```python
# index.html 서빙과 랭킹 조회/등록 뷰
from django.shortcuts import render


def index(request):
    return render(request, "index.html")
```

`game/templates/index.html` — 이번 태스크에서는 뼈대만 만든다. Task 3~6이 이 안을 채운다.

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="csrf-token" content="{{ csrf_token }}" />
  <title>포즈 러너</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; background: #0b1020; color: #e8ecf5;
      font-family: system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif;
      overflow: hidden;
    }
    #stage { position: relative; width: 100vw; height: 100vh; }
    #canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="stage">
    <canvas id="canvas"></canvas>
  </div>
  <script type="module">
    // ── 상수·랜드마크 인덱스·공용 헬퍼   (Task 3)
    // ── InputMapper                      (Task 3)
    // ── 셀프 테스트 (?test=1)            (Task 3)
    // ── Game                             (Task 4)
    // ── 키보드 소스                      (Task 4)
    // ── PoseTracker                      (Task 5)
    // ── 디버그 패널                      (Task 5)
    // ── 화면 전환·API·부트               (Task 6)
  </script>
</body>
</html>
```

`.gitignore`는 이미 `credentials.json`, `__pycache__/`, `*.pyc`, `db.sqlite3`, `.venv/`,
`.superpowers/`를 담고 있다. 손대지 않는다.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `.venv/bin/pytest -q`
Expected: `2 passed`

- [ ] **Step 6: 프로젝트 문서 두 개를 만든다**

`checklist.md` — 태스크 단위 추적기다. 세부 단계는 계획서에 있으므로 중복하지 않는다.

```markdown
# 체크리스트

계획서 `docs/superpowers/plans/2026-07-15-subway-surfers-pose-game.md`의 태스크 단위 추적.

- [x] Task 1 — Django 스캐폴드 + index 서빙 + 프로젝트 문서
- [ ] Task 2 — Sheets 래퍼 + 랭킹 API
- [ ] Task 3 — InputMapper + ?test=1 셀프 테스트
- [ ] Task 4 — Game 엔진 + 키보드 모드
- [ ] Task 5 — PoseTracker + 디버그 패널
- [ ] Task 6 — 화면 전환 + 점수 연동
- [ ] 실측 튜닝 — 임계값을 몸으로 조정하고 context-notes.md에 확정값 기록
```

`context-notes.md` — 구현 중 결정과 근거를 계속 덧붙인다.

```markdown
# 컨텍스트 노트

## 착수 전 검증으로 확정된 사실 (2026-07-15)

- MediaPipe tasks-vision **0.10.35**. UMD 빌드가 없어 ESM만 가능하다. 공식 문서의
  `<script src>` 예제는 `SyntaxError`가 나고 전역을 만들지 않는다.
- 랜드마크 `visibility`는 채워진다. 설계 문서가 남긴 미확인 사항은 해소됐고 대체 수단은
  필요 없다. 값이 안 온다는 보고는 2023년 이슈이며 PR #5142로 2024-03에 수정됐다.
  실측 범위 0.941~0.99999. `presence`는 JS API에 없다.
- `detectForVideo`는 타임스탬프가 필수이고 동기로 반환한다. 문서 예제가 틀렸다.
- Python 3.14.4에서 Django 6.0.7 + gspread 6.2.1이 동작한다.
- `DATABASES = {}`로 DB 없이 부팅된다.
- pytest-django는 `pytest.ini`에 `pythonpath = .`이 없으면 설정 모듈을 못 찾는다.

## 설계 문서에서 바뀐 결정

- **MediaPipe 로드는 동적 `import()` + try/catch로 한다.** 정적 `import`는 CDN 실패 시
  모듈 전체가 죽어 키보드 폴백까지 같이 죽는다. 설계 문서의 "로드 실패 → 키보드 모드"
  요구를 만족하려면 동적 import가 유일한 방법이다.
- **jump/slide는 한 프레임짜리 엣지 이벤트로 정한다.** 셀프 테스트 기준이 "정확히 1회
  발화"이므로 상태 방식이면 셀 수 없다. 600ms 애니메이션은 Game이, 900ms 불응기는
  InputMapper가 소유한다.

## 구현 중 결정

(여기에 계속 덧붙인다)
```

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: Django 스캐폴드와 index 서빙 추가"
```

---

### Task 2: Sheets 래퍼 + 랭킹 API

**Files:**
- Create: `game/sheets.py`
- Modify: `game/views.py`, `game/urls.py`
- Test: `game/tests/test_api.py`

**Interfaces:**
- Consumes: `config.settings.GOOGLE_CREDENTIALS`, `config.settings.SHEET_ID`
- Produces:
  - `game.sheets.top_scores(limit: int = 10) -> list[dict]` — `{"nickname": str, "score": int}` 리스트를 점수 내림차순으로 반환
  - `game.sheets.append_score(nickname: str, score: int) -> None`
  - `game.sheets._worksheet() -> gspread.Worksheet` — 테스트는 이 함수를 모킹한다
  - `GET /api/scores/` → `{"scores": [{"nickname", "score"}, …]}`
  - `POST /api/scores/` body `{"nickname": str, "score": int}` → `{"ok": true}`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`game/tests/test_api.py`에 아래를 **덧붙인다.** Task 1의 두 테스트는 그대로 둔다.

```python
import json
from unittest.mock import MagicMock, patch

from game import sheets


def _mock_worksheet(records=None):
    worksheet = MagicMock()
    worksheet.get_all_records.return_value = records or []
    return worksheet


def test_get_scores_returns_top10_desc(client):
    records = [{"nickname": f"p{i}", "score": i * 10} for i in range(15)]
    worksheet = _mock_worksheet(records)
    with patch.object(sheets, "_worksheet", return_value=worksheet):
        response = client.get("/api/scores/")
    assert response.status_code == 200
    scores = response.json()["scores"]
    assert len(scores) == 10
    assert [s["score"] for s in scores] == [140, 130, 120, 110, 100, 90, 80, 70, 60, 50]
    assert scores[0]["nickname"] == "p14"


def test_post_score_appends_row(client):
    worksheet = _mock_worksheet()
    with patch.object(sheets, "_worksheet", return_value=worksheet):
        response = client.post(
            "/api/scores/",
            data=json.dumps({"nickname": "홍길동", "score": 320}),
            content_type="application/json",
        )
    assert response.status_code == 200
    assert worksheet.append_row.call_count == 1
    row = worksheet.append_row.call_args.args[0]
    assert row[0] == "홍길동"
    assert row[1] == 320
    assert row[2]  # played_at 이 비어 있지 않다


def test_post_rejects_long_nickname(client):
    worksheet = _mock_worksheet()
    with patch.object(sheets, "_worksheet", return_value=worksheet):
        response = client.post(
            "/api/scores/",
            data=json.dumps({"nickname": "a" * 13, "score": 10}),
            content_type="application/json",
        )
    assert response.status_code == 400
    assert worksheet.append_row.call_count == 0


def test_post_rejects_non_dict_body(client):
    # json.loads 를 통과하지만 dict 가 아닌 본문들이다
    for body in ["null", "42", '"x"', "[1,2,3]"]:
        worksheet = _mock_worksheet()
        with patch.object(sheets, "_worksheet", return_value=worksheet):
            response = client.post(
                "/api/scores/", data=body, content_type="application/json"
            )
        assert response.status_code == 400, f"본문 {body} 가 400 이 아니다"
        assert worksheet.append_row.call_count == 0


def test_post_rejects_non_integer_score(client):
    worksheet = _mock_worksheet()
    with patch.object(sheets, "_worksheet", return_value=worksheet):
        response = client.post(
            "/api/scores/",
            data=json.dumps({"nickname": "abc", "score": True}),
            content_type="application/json",
        )
    assert response.status_code == 400
    assert worksheet.append_row.call_count == 0


def test_sheet_failure_becomes_error_response_not_crash(client):
    with patch.object(sheets, "_worksheet", side_effect=RuntimeError("시트 접근 불가")):
        response = client.get("/api/scores/")
    assert response.status_code == 503
    assert "error" in response.json()
```

`score: True` 케이스를 넣는 이유가 있다. 파이썬에서 `isinstance(True, int)`는 `True`라서 순진한 정수 검증은 JSON `true`를 점수로 통과시킨다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `.venv/bin/pytest -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'game.sheets'`

- [ ] **Step 3: sheets.py를 작성한다**

`game/sheets.py`

```python
# gspread 래퍼. 이 모듈만 Google Sheets를 안다
from django.conf import settings

_client = None


def _worksheet():
    """워크시트를 반환한다. 테스트는 이 함수를 모킹한다."""
    global _client
    if _client is None:
        import gspread

        _client = gspread.service_account(filename=settings.GOOGLE_CREDENTIALS)
    return _client.open_by_key(settings.SHEET_ID).sheet1


def top_scores(limit=10):
    rows = _worksheet().get_all_records()
    parsed = []
    for row in rows:
        try:
            parsed.append(
                {"nickname": str(row["nickname"]), "score": int(row["score"])}
            )
        except (KeyError, TypeError, ValueError):
            continue  # 손상된 행은 건너뛴다. 시트는 사람이 손댈 수 있다
    parsed.sort(key=lambda r: r["score"], reverse=True)
    return parsed[:limit]


def append_score(nickname, score):
    played_at = _now_iso()
    _worksheet().append_row([nickname, score, played_at])


def _now_iso():
    from django.utils import timezone

    return timezone.localtime().isoformat(timespec="seconds")
```

`import gspread`를 함수 안에 두는 이유가 있다. 모듈 로드 시점에 자격증명을 요구하지 않아 `credentials.json` 없이도 테스트가 돈다.

- [ ] **Step 4: 뷰와 라우팅을 작성한다**

`game/views.py` — 파일 전체를 아래로 교체한다.

```python
# index.html 서빙과 랭킹 조회/등록 뷰
import json

from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_http_methods

from . import sheets

NICKNAME_MAX = 12


def index(request):
    return render(request, "index.html")


@require_http_methods(["GET", "POST"])
def scores(request):
    if request.method == "GET":
        return _get_scores()
    return _post_score(request)


def _get_scores():
    try:
        return JsonResponse({"scores": sheets.top_scores(10)})
    except Exception:
        # 시트는 부가 기능이다. 실패를 응답으로 바꾸고 게임은 계속 돌게 한다
        return JsonResponse({"error": "랭킹을 불러올 수 없습니다"}, status=503)


def _post_score(request):
    try:
        payload = json.loads(request.body)
    except (ValueError, TypeError):
        return JsonResponse({"error": "잘못된 요청입니다"}, status=400)

    # json.loads 는 null, 42, "x", [1,2,3] 도 통과시킨다.
    # 이 가드가 없으면 payload.get() 이 AttributeError 를 내고 400 이 아니라 500 이 된다
    if not isinstance(payload, dict):
        return JsonResponse({"error": "잘못된 요청입니다"}, status=400)

    nickname = str(payload.get("nickname", "")).strip()
    if not 1 <= len(nickname) <= NICKNAME_MAX:
        return JsonResponse(
            {"error": f"닉네임은 1~{NICKNAME_MAX}자여야 합니다"}, status=400
        )

    score = payload.get("score")
    # bool 은 int 의 하위 타입이라 따로 걸러야 한다
    if isinstance(score, bool) or not isinstance(score, int) or score < 0:
        return JsonResponse({"error": "점수가 올바르지 않습니다"}, status=400)

    try:
        sheets.append_score(nickname, score)
    except Exception:
        return JsonResponse({"error": "점수를 저장할 수 없습니다"}, status=503)

    return JsonResponse({"ok": True})
```

`game/urls.py` — 파일 전체를 아래로 교체한다.

```python
# 게임 앱 URL 라우팅
from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("api/scores/", views.scores, name="scores"),
]
```

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `.venv/bin/pytest -q`
Expected: `8 passed`

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: Google Sheets 랭킹 조회/등록 API 추가"
```

---

### Task 3: InputMapper + `?test=1` 셀프 테스트

**Files:**
- Modify: `game/templates/index.html` — `(Task 3)` 마커 세 자리

**Interfaces:**
- Consumes: 없음. 순수 로직이며 MediaPipe도 Canvas도 모른다
- Produces:
  - `LM` — 랜드마크 인덱스 상수 `{EYE_L:2, EYE_R:5, SHO_L:11, SHO_R:12, HIP_L:23, HIP_R:24, ANK_L:27, ANK_R:28}`
  - `DEFAULT_CFG` — 임계값 객체 (Task 5의 디버그 패널이 슬라이더로 이 값을 바꾼다)
  - `createInputMapper(overrides?) -> { addCalibrationSample(lm), commitCalibration() -> bool, update(lm, nowMs) -> Signal, getDebug() -> DebugInfo, isCalibrated() -> bool, cfg }`
  - `Signal = { lane: 0|1|2, jump: boolean, slide: boolean, warning: string|null }` — Task 4의 Game과 Task 6의 루프가 소비한다
  - `DebugInfo = { jumpAmount: number, slideAmount: number, laneX: number, ankleVisibility: number }` — Task 5의 디버그 패널이 소비한다
  - `makePose(opts)` — 합성 랜드마크 생성기. 셀프 테스트 전용

- [ ] **Step 1: 상수와 헬퍼를 넣는다**

`index.html`의 `// ── 상수·랜드마크 인덱스·공용 헬퍼   (Task 3)` 마커를 아래로 교체한다.

```js
// ── 상수·랜드마크 인덱스·공용 헬퍼
// MediaPipe 랜드마크 인덱스. 좌우 쌍은 중점을 쓴다
const LM = {
  EYE_L: 2, EYE_R: 5,
  SHO_L: 11, SHO_R: 12,
  HIP_L: 23, HIP_R: 24,
  ANK_L: 27, ANK_R: 28,
};

const DEFAULT_CFG = {
  jumpThreshold: 0.2,     // 몸통 길이 대비
  slideThreshold: 0.5,    // 몸통 길이 대비
  baselineAlpha: 0.02,    // 기준선 추종 EMA
  laneAlpha: 0.3,         // 레인 x EMA
  animMs: 600,
  refractoryMs: 300,
  visibilityMin: 0.5,
  laneOutLeft: 0.30,      // 가운데 → 왼쪽
  laneOutRight: 0.70,     // 가운데 → 오른쪽
  laneInLeft: 0.36,       // 왼쪽 → 가운데
  laneInRight: 0.64,      // 오른쪽 → 가운데
};

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

// y는 아래로 갈수록 커진다. 위로 올라감 = y 감소
function poseMetrics(lm) {
  const shoulder = midpoint(lm[LM.SHO_L], lm[LM.SHO_R]);
  const hip = midpoint(lm[LM.HIP_L], lm[LM.HIP_R]);
  const eye = midpoint(lm[LM.EYE_L], lm[LM.EYE_R]);
  const ankle = midpoint(lm[LM.ANK_L], lm[LM.ANK_R]);
  const torsoLen = Math.abs(shoulder.y - hip.y);
  return { shoulder, hip, eye, ankle, torsoLen };
}
```

- [ ] **Step 2: InputMapper를 넣는다**

`// ── InputMapper                      (Task 3)` 마커를 아래로 교체한다.

```js
// ── InputMapper — 랜드마크를 조작 신호로 바꾼다. 카메라도 게임도 모른다
function createInputMapper(overrides = {}) {
  const cfg = { ...DEFAULT_CFG, ...overrides };
  let baseline = null;          // { ankleY, eyeY }
  let calibSamples = [];
  let smoothedLaneX = null;
  let lane = 1;
  let lockUntilMs = 0;
  let jumpWasOver = false;
  let slideWasOver = false;
  let lastSignal = { lane: 1, jump: false, slide: false, warning: null };
  let debug = { jumpAmount: 0, slideAmount: 0, laneX: 0.5, ankleVisibility: 1 };

  function addCalibrationSample(lm) {
    if (!lm) return;
    const m = poseMetrics(lm);
    if (m.torsoLen < 1e-6) return;
    calibSamples.push({ ankleY: m.ankle.y, eyeY: m.eye.y });
  }

  function commitCalibration() {
    if (calibSamples.length === 0) return false;
    const n = calibSamples.length;
    baseline = {
      ankleY: calibSamples.reduce((s, c) => s + c.ankleY, 0) / n,
      eyeY: calibSamples.reduce((s, c) => s + c.eyeY, 0) / n,
    };
    calibSamples = [];
    return true;
  }

  function hold(warning) {
    lastSignal = { lane: lastSignal.lane, jump: false, slide: false, warning };
    return lastSignal;
  }

  function update(lm, nowMs) {
    if (!lm) return hold('포즈를 찾을 수 없습니다');
    if (!baseline) return hold('캘리브레이션 전입니다');

    const m = poseMetrics(lm);
    if (m.torsoLen < 1e-6) return hold('포즈를 찾을 수 없습니다');

    // 레인 — 웹캠은 거울이 아니므로 뒤집는다. 엉덩이 중점을 쓴다 (머리는 흔들린다)
    const laneX = 1 - m.hip.x;
    smoothedLaneX = smoothedLaneX === null
      ? laneX
      : smoothedLaneX + cfg.laneAlpha * (laneX - smoothedLaneX);
    if (lane === 1) {
      if (smoothedLaneX < cfg.laneOutLeft) lane = 0;
      else if (smoothedLaneX > cfg.laneOutRight) lane = 2;
    } else if (lane === 0) {
      if (smoothedLaneX > cfg.laneInLeft) lane = 1;
    } else {
      if (smoothedLaneX < cfg.laneInRight) lane = 1;
    }

    // 몸통 길이로 나눠 거리 변화에 무관하게 만든다.
    // 발목 y 에는 EMA 를 걸지 않는다. 빠뜨린 게 아니라 의도적이다 —
    // 점프는 짧고 빠른 순간 신호라 스무딩하면 봉우리가 뭉개져 감지 자체가 안 된다
    const jumpAmount = (baseline.ankleY - m.ankle.y) / m.torsoLen;   // 발목이 뜨면 양수
    const slideAmount = (m.eye.y - baseline.eyeY) / m.torsoLen;      // 머리가 내려가면 양수
    const ankleVisibility = m.ankle.visibility;
    const ankleOk = ankleVisibility >= cfg.visibilityMin;

    // 상승 엣지에서만 발화한다. 발화 후 애니메이션+불응기 동안 잠근다
    const locked = nowMs < lockUntilMs;
    const jumpOver = ankleOk && jumpAmount > cfg.jumpThreshold;
    const slideOver = slideAmount > cfg.slideThreshold;
    let jump = false;
    let slide = false;
    if (!locked) {
      if (jumpOver && !jumpWasOver) {
        jump = true;
        lockUntilMs = nowMs + cfg.animMs + cfg.refractoryMs;
      } else if (slideOver && !slideWasOver) {
        slide = true;
        lockUntilMs = nowMs + cfg.animMs + cfg.refractoryMs;
      }
    }
    jumpWasOver = jumpOver;
    slideWasOver = slideOver;

    // 기준선 추종 — 판정 중에는 절대 갱신하지 않는다.
    // 이 가드가 없으면 슬라이드 자세가 기준선으로 굳어 슬라이드가 영영 안 먹는다
    const quiet =
      Math.abs(jumpAmount) < cfg.jumpThreshold / 2 &&
      Math.abs(slideAmount) < cfg.slideThreshold / 2;
    if (quiet && !locked && !jump && !slide) {
      baseline.ankleY += cfg.baselineAlpha * (m.ankle.y - baseline.ankleY);
      baseline.eyeY += cfg.baselineAlpha * (m.eye.y - baseline.eyeY);
    }

    debug = { jumpAmount, slideAmount, laneX: smoothedLaneX, ankleVisibility };
    lastSignal = {
      lane,
      jump,
      slide,
      warning: ankleOk ? null : '발이 화면에 보이지 않습니다',
    };
    return lastSignal;
  }

  return {
    addCalibrationSample,
    commitCalibration,
    update,
    cfg,
    getDebug: () => debug,
    isCalibrated: () => baseline !== null,
  };
}
```

- [ ] **Step 3: 셀프 테스트를 넣는다**

`// ── 셀프 테스트 (?test=1)            (Task 3)` 마커를 아래로 교체한다.

기본 자세의 몸통 길이는 `|0.30 - 0.55| = 0.25`다. 점프 임계 0.2몸통 = y로 0.05, 슬라이드 임계 0.5몸통 = y로 0.125다. 아래 시퀀스의 숫자는 전부 이 계산에서 나왔다.

```js
// ── 셀프 테스트 — 단일 파일 제약으로 외부 러너를 못 붙이는 것에 대한 우회
function makePose({
  hipX = 0.5,
  eyeY = 0.10,
  shoulderY = 0.30,
  hipY = 0.55,
  ankleY = 0.90,
  visibility = 1.0,
  ankleVisibility = null,
} = {}) {
  const av = ankleVisibility === null ? visibility : ankleVisibility;
  const lm = Array.from({ length: 33 }, () => ({ x: hipX, y: 0.5, z: 0, visibility }));
  lm[LM.EYE_L] = { x: hipX - 0.02, y: eyeY, z: 0, visibility };
  lm[LM.EYE_R] = { x: hipX + 0.02, y: eyeY, z: 0, visibility };
  lm[LM.SHO_L] = { x: hipX - 0.08, y: shoulderY, z: 0, visibility };
  lm[LM.SHO_R] = { x: hipX + 0.08, y: shoulderY, z: 0, visibility };
  lm[LM.HIP_L] = { x: hipX - 0.05, y: hipY, z: 0, visibility };
  lm[LM.HIP_R] = { x: hipX + 0.05, y: hipY, z: 0, visibility };
  lm[LM.ANK_L] = { x: hipX - 0.05, y: ankleY, z: 0, visibility: av };
  lm[LM.ANK_R] = { x: hipX + 0.05, y: ankleY, z: 0, visibility: av };
  return lm;
}

function runSelfTests() {
  const results = [];
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  function check(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, msg: e.message }); }
  }

  // 프레임 시퀀스를 흘려보내고 발화 횟수를 센다
  function feed(mapper, poses, startMs = 0, stepMs = 33) {
    let jumps = 0, slides = 0, lane = 1;
    poses.forEach((p, i) => {
      const s = mapper.update(p, startMs + i * stepMs);
      if (s.jump) jumps++;
      if (s.slide) slides++;
      lane = s.lane;
    });
    return { jumps, slides, lane };
  }

  function calibrated(makeStand = () => makePose(), overrides) {
    const m = createInputMapper(overrides);
    for (let i = 0; i < 30; i++) m.addCalibrationSample(makeStand());
    m.commitCalibration();
    return m;
  }

  const stand = () => makePose();

  check('점프 시퀀스에서 jump가 정확히 1회 발화한다', () => {
    // 0.90 → 0.83 은 0.07/0.25 = 0.28 몸통. 임계 0.2 를 넘는다
    const m = calibrated();
    const seq = [
      stand(), stand(), stand(),
      makePose({ ankleY: 0.86 }),   // 0.16 몸통 — 아직 아니다
      makePose({ ankleY: 0.83 }),   // 0.28 몸통 — 여기서 발화
      makePose({ ankleY: 0.84 }),   // 0.24 몸통 — 여전히 넘지만 새 엣지가 아니다
      stand(), stand(), stand(),
    ];
    const r = feed(m, seq);
    assert(r.jumps === 1, `jump ${r.jumps}회 발화 (기대 1)`);
  });

  check('슬라이드 시퀀스에서 slide가 정확히 1회 발화한다', () => {
    // 눈 0.10 → 0.26 은 0.16/0.25 = 0.64 몸통. 임계 0.5 를 넘는다
    const m = calibrated();
    const seq = [
      stand(),
      makePose({ eyeY: 0.20 }),   // 0.40 몸통 — 아직 아니다
      makePose({ eyeY: 0.26 }),   // 0.64 몸통 — 여기서 발화
      makePose({ eyeY: 0.22 }),
      stand(), stand(),
    ];
    const r = feed(m, seq);
    assert(r.slides === 1, `slide ${r.slides}회 발화 (기대 1)`);
    assert(r.jumps === 0, `슬라이드인데 jump가 ${r.jumps}회 발화했다`);
  });

  check('불응기 안의 두 번째 점프는 무시된다', () => {
    const m = calibrated();
    const pulse = [makePose({ ankleY: 0.83 }), stand()];
    // 약 130ms 안에 두 번. 불응기 900ms 이므로 1회만 나와야 한다
    const r = feed(m, [stand(), ...pulse, ...pulse]);
    assert(r.jumps === 1, `jump ${r.jumps}회 발화 (기대 1)`);
  });

  check('레인 이동이 좌·중·우로 올바르게 판정된다', () => {
    // laneX = 1 - hipX 이므로 hipX 0.85 → laneX 0.15 → 왼쪽
    const left = feed(calibrated(), Array.from({ length: 30 }, () => makePose({ hipX: 0.85 })));
    assert(left.lane === 0, `왼쪽 기대 0, 실제 ${left.lane}`);
    const mid = feed(calibrated(), Array.from({ length: 30 }, () => makePose({ hipX: 0.50 })));
    assert(mid.lane === 1, `가운데 기대 1, 실제 ${mid.lane}`);
    const right = feed(calibrated(), Array.from({ length: 30 }, () => makePose({ hipX: 0.15 })));
    assert(right.lane === 2, `오른쪽 기대 2, 실제 ${right.lane}`);
  });

  check('경계에서 미세하게 흔들 때 레인이 떨리지 않는다', () => {
    const m = calibrated();
    feed(m, Array.from({ length: 20 }, () => stand()));   // 가운데서 안정
    let flips = 0;
    let prev = 1;
    for (let i = 0; i < 40; i++) {
      // hipX 0.695/0.705 → laneX 0.305/0.295. 경계 0.30 을 사이에 두고 진동한다
      const hipX = 0.695 + (i % 2) * 0.01;
      const s = m.update(makePose({ hipX }), 2000 + i * 33);
      if (s.lane !== prev) { flips++; prev = s.lane; }
    }
    assert(flips <= 1, `레인이 ${flips}회 바뀌었다 (기대 1회 이하)`);
  });

  check('앞뒤로 움직여 스케일이 변해도 판정이 유지된다', () => {
    // 멀리 선 사람 — 몸통 길이가 절반(0.125)이다. 같은 비율의 점프는 여전히 감지돼야 한다
    const far = (o = {}) =>
      makePose({ shoulderY: 0.40, hipY: 0.525, ankleY: 0.70, eyeY: 0.35, ...o });
    const m = calibrated(far);
    // 0.70 → 0.67 은 0.03/0.125 = 0.24 몸통. 가까이 있을 때와 같은 비율이다
    const r = feed(m, [far(), far({ ankleY: 0.67 }), far()]);
    assert(r.jumps === 1, `먼 거리에서 jump ${r.jumps}회 발화 (기대 1)`);
  });

  check('발목 visibility가 낮으면 점프가 발화하지 않는다', () => {
    const m = calibrated();
    const seq = [
      stand(),
      makePose({ ankleY: 0.83, ankleVisibility: 0.2 }),
      makePose({ ankleY: 0.84, ankleVisibility: 0.2 }),
      stand(),
    ];
    const r = feed(m, seq);
    assert(r.jumps === 0, `visibility 낮은데 jump가 ${r.jumps}회 발화했다`);
  });

  return results;
}

function renderSelfTests(results) {
  const passed = results.filter((r) => r.ok).length;
  const rows = results
    .map((r) => `<li style="color:${r.ok ? '#7ef6a0' : '#ff6b6b'}">
        ${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.msg ? `<br><small>${r.msg}</small>` : ''}
      </li>`)
    .join('');
  document.body.innerHTML = `
    <div style="padding:24px;font-family:system-ui;line-height:1.7">
      <h1>InputMapper 셀프 테스트</h1>
      <p style="font-size:20px">${passed} / ${results.length} 통과</p>
      <ul style="list-style:none;padding:0">${rows}</ul>
    </div>`;
}
```

- [ ] **Step 4: 부트 분기를 임시로 넣는다**

`// ── 화면 전환·API·부트               (Task 6)` 마커를 아래로 교체한다. Task 6이 이 자리를 다시 채운다.

```js
// ── 화면 전환·API·부트               (Task 6)
if (new URLSearchParams(location.search).get('test') === '1') {
  renderSelfTests(runSelfTests());
}
```

- [ ] **Step 5: 셀프 테스트를 돌려 통과를 확인한다**

```bash
.venv/bin/python manage.py runserver 8000
```

브라우저에서 `http://localhost:8000/?test=1`을 연다.
Expected: `7 / 7 통과`. 모든 줄이 초록색이다.

실패하면 임계값 계산을 다시 확인한다. 기본 자세 몸통 길이가 0.25라는 전제가 `makePose`의 `shoulderY`/`hipY` 기본값에서 나온다.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: InputMapper와 ?test=1 셀프 테스트 추가"
```

---

### Task 4: Game 엔진 + 키보드 모드

**Files:**
- Modify: `game/templates/index.html` — `(Task 4)` 마커 두 자리, `<style>`, `#stage` DOM, Task 3이 넣은 부트 분기

**Interfaces:**
- Consumes: `Signal` (Task 3의 `createInputMapper().update()` 반환형)
- Produces:
  - `createGame(canvas) -> { reset(seed, startMs), step(signal, nowMs), render(), getState() -> 'idle'|'playing'|'over', getScore() -> number }`
  - `createKeyboardSource() -> { read() -> Signal }` — InputMapper와 동일한 엣지 의미다
  - `Z_CHAR`, `JUMP_MS`, `SLIDE_MS` 등 게임 상수

- [ ] **Step 1: 게임 상수와 투영을 넣는다**

`// ── Game                             (Task 4)` 마커를 아래로 교체한다.

```js
// ── Game — 조작 신호만 받아 상태를 굴리고 그린다. 포즈의 존재를 모른다
const Z_SPAWN = 100;          // 소실점 z
const Z_CHAR = 3;             // 캐릭터 z
const Z_DESPAWN = -5;
const PERSPECTIVE_K = 0.06;   // 원근 강도
const BASE_SPEED = 18;        // z/초
const SPEED_GROWTH = 0.35;    // 초당 증가
const MAX_SPEED = 55;
const BASE_GAP = 22;          // BASE_SPEED 기준 스폰 간격
const LANE_SPREAD = 0.26;     // 화면폭 대비 레인 간격
const JUMP_MS = 600;
const SLIDE_MS = 600;
const COIN_VALUE = 10;
const HORIZON_RATIO = 0.35;

// z가 클수록 멀고 작다. z=0 에서 scale=1
function project(z, height) {
  const scale = 1 / (1 + z * PERSPECTIVE_K);
  const horizonY = height * HORIZON_RATIO;
  return { y: horizonY + (height - horizonY) * scale, scale, horizonY };
}

function laneScreenX(laneFloat, scale, width) {
  return width / 2 + (laneFloat - 1) * LANE_SPREAD * width * scale;
}

// 결정적 난수. 시드를 고정하면 같은 코스가 재현된다
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clears(kind, isJumping, isSliding) {
  if (kind === 'barricade') return isJumping;
  if (kind === 'beam') return isSliding;
  return false;   // pillar — 레인을 바꾸는 수밖에 없다
}
```

- [ ] **Step 2: 스폰 규칙과 게임 본체를 넣는다**

Step 1에서 넣은 블록 바로 뒤에 이어 붙인다.

```js
// 게임은 항상 클리어 가능해야 한다.
// 기둥을 최대 2개로 제한하면 최소 한 레인은 기둥이 아니게 되고,
// 기둥 아닌 레인은 빈 레인이거나 점프/슬라이드로 통과 가능하다
function spawnGroup(rng, atZ) {
  const kinds = [null, null, null];
  const pillarCount = Math.floor(rng() * 3);   // 0, 1, 2
  const lanes = [0, 1, 2];
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  for (let i = 0; i < pillarCount; i++) kinds[lanes[i]] = 'pillar';

  for (let l = 0; l < 3; l++) {
    if (kinds[l]) continue;
    const r = rng();
    if (r < 0.25) kinds[l] = 'barricade';
    else if (r < 0.45) kinds[l] = 'beam';
  }

  const objects = [];
  for (let l = 0; l < 3; l++) {
    if (kinds[l]) objects.push({ kind: kinds[l], lane: l, z: atZ, dead: false });
  }

  // 코인은 완전히 빈 레인에만 둔다. 플레이어를 함정으로 유인하지 않는다
  const emptyLanes = [0, 1, 2].filter((l) => !kinds[l]);
  if (emptyLanes.length > 0 && rng() < 0.6) {
    const l = emptyLanes[Math.floor(rng() * emptyLanes.length)];
    objects.push({ kind: 'coin', lane: l, z: atZ, dead: false });
  }
  return objects;
}

function createGame(canvas) {
  const ctx = canvas.getContext('2d');
  let state = 'idle';
  let lane = 1;
  let laneVisual = 1;
  let jumpEndMs = 0;
  let slideEndMs = 0;
  let speed = BASE_SPEED;
  let distance = 0;
  let coins = 0;
  let elapsed = 0;
  let objects = [];
  let zSinceSpawn = 0;
  let lastMs = 0;
  let rng = mulberry32(1);
  let nowMs = 0;

  function reset(seed = 1, startMs = 0) {
    state = 'playing';
    lane = 1; laneVisual = 1;
    jumpEndMs = 0; slideEndMs = 0;
    speed = BASE_SPEED; distance = 0; coins = 0; elapsed = 0;
    objects = []; zSinceSpawn = 0;
    lastMs = startMs; nowMs = startMs;
    rng = mulberry32(seed);
  }

  function step(signal, atMs) {
    if (state !== 'playing') return;
    nowMs = atMs;
    // 탭 전환 후 델타가 폭발해 장애물을 관통하는 것을 막는다
    const dt = Math.min((atMs - lastMs) / 1000, 0.05);
    lastMs = atMs;
    if (dt <= 0) return;

    elapsed += dt;
    speed = Math.min(BASE_SPEED + SPEED_GROWTH * elapsed, MAX_SPEED);
    distance += speed * dt;

    lane = signal.lane;
    const busy = atMs < jumpEndMs || atMs < slideEndMs;
    if (signal.jump && !busy) jumpEndMs = atMs + JUMP_MS;
    else if (signal.slide && !busy) slideEndMs = atMs + SLIDE_MS;
    const isJumping = atMs < jumpEndMs;
    const isSliding = atMs < slideEndMs;

    laneVisual += (lane - laneVisual) * Math.min(1, dt * 12);

    // 속도가 오르면 간격도 벌려 반응 시간을 일정하게 유지한다
    zSinceSpawn += speed * dt;
    if (zSinceSpawn >= BASE_GAP * (speed / BASE_SPEED)) {
      objects.push(...spawnGroup(rng, Z_SPAWN));
      zSinceSpawn = 0;
    }

    for (const o of objects) {
      const prevZ = o.z;
      o.z -= speed * dt;
      // 교차 판정이라 속도가 아무리 올라도 관통하지 않는다
      if (prevZ > Z_CHAR && o.z <= Z_CHAR && o.lane === lane) {
        if (o.kind === 'coin') {
          coins += 1;
          o.dead = true;
        } else if (!clears(o.kind, isJumping, isSliding)) {
          state = 'over';
          return;
        }
      }
    }
    objects = objects.filter((o) => !o.dead && o.z > Z_DESPAWN);
  }

  function drawObject(o, W, H) {
    const p = project(o.z, H);
    if (p.scale <= 0.02) return;
    const x = laneScreenX(o.lane, p.scale, W);
    const w = LANE_SPREAD * W * p.scale * 0.7;
    if (o.kind === 'coin') {
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.arc(x, p.y - 60 * p.scale, 14 * p.scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (o.kind === 'barricade') {
      ctx.fillStyle = '#e5533d';
      ctx.fillRect(x - w / 2, p.y - 30 * p.scale, w, 30 * p.scale);
    } else if (o.kind === 'beam') {
      ctx.fillStyle = '#4da3ff';
      ctx.fillRect(x - w / 2, p.y - 150 * p.scale, w, 30 * p.scale);
    } else {
      ctx.fillStyle = '#9b6dff';
      ctx.fillRect(x - w / 4, p.y - 160 * p.scale, w / 2, 160 * p.scale);
    }
  }

  function drawCharacter(W, H) {
    const p = project(Z_CHAR, H);
    const x = laneScreenX(laneVisual, p.scale, W);
    let hop = 0;
    if (nowMs < jumpEndMs) {
      const t = 1 - (jumpEndMs - nowMs) / JUMP_MS;   // 0 → 1
      hop = Math.sin(t * Math.PI) * 90;
    }
    const h = nowMs < slideEndMs ? 30 : 70;
    ctx.fillStyle = '#7ef6a0';
    ctx.fillRect(
      x - 16 * p.scale,
      p.y - (h + hop) * p.scale,
      32 * p.scale,
      h * p.scale
    );
  }

  function render() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#111a33';
    ctx.fillRect(0, 0, W, H * HORIZON_RATIO);
    ctx.fillStyle = '#1b2a4a';
    ctx.fillRect(0, H * HORIZON_RATIO, W, H * (1 - HORIZON_RATIO));

    const near = project(0, H);
    const far = project(Z_SPAWN, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    for (const edge of [-0.5, 0.5, 1.5, 2.5]) {
      ctx.beginPath();
      ctx.moveTo(laneScreenX(edge, near.scale, W), near.y);
      ctx.lineTo(laneScreenX(edge, far.scale, W), far.y);
      ctx.stroke();
    }

    for (const o of [...objects].sort((a, b) => b.z - a.z)) drawObject(o, W, H);
    drawCharacter(W, H);

    ctx.fillStyle = '#e8ecf5';
    ctx.font = '600 24px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`${getScore()}점`, 24, 44);
    ctx.font = '400 15px system-ui';
    ctx.fillStyle = 'rgba(232,236,245,0.65)';
    ctx.fillText(`코인 ${coins}   속도 ${speed.toFixed(0)}`, 24, 70);
  }

  const getScore = () => Math.floor(distance) + coins * COIN_VALUE;

  return { reset, step, render, getState: () => state, getScore };
}
```

- [ ] **Step 3: 키보드 소스를 넣는다**

`// ── 키보드 소스                      (Task 4)` 마커를 아래로 교체한다.

```js
// ── 키보드 소스 — 개발 편의가 아니라 필수 인프라다.
// 게임 로직을 고칠 때마다 2m 뒤로 물러나 뛸 수는 없다.
// InputMapper 와 동일하게 jump/slide 는 한 프레임짜리 엣지다
function createKeyboardSource() {
  let lane = 1;
  let jump = false;
  let slide = false;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft') lane = Math.max(0, lane - 1);
    else if (e.key === 'ArrowRight') lane = Math.min(2, lane + 1);
    else if (e.key === 'ArrowUp' || e.key === ' ') jump = true;
    else if (e.key === 'ArrowDown') slide = true;
    else return;
    e.preventDefault();
  });

  return {
    read() {
      const signal = { lane, jump, slide, warning: null };
      jump = false;
      slide = false;
      return signal;
    },
    reset() { lane = 1; jump = false; slide = false; },
  };
}
```

- [ ] **Step 4: 캔버스 크기 조정과 임시 부트를 넣는다**

Task 3이 넣은 부트 분기를 아래로 교체한다.

```js
// ── 화면 전환·API·부트               (Task 6)
const canvas = document.getElementById('canvas');

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

if (new URLSearchParams(location.search).get('test') === '1') {
  renderSelfTests(runSelfTests());
} else {
  // 임시 부트 — Task 6 이 시작 화면으로 교체한다
  const game = createGame(canvas);
  const keyboard = createKeyboardSource();
  game.reset(1, performance.now());
  (function loop(nowMs) {
    requestAnimationFrame(loop);
    if (game.getState() === 'over') {
      keyboard.reset();
      game.reset(Math.floor(nowMs) % 100000, nowMs);
      return;
    }
    game.step(keyboard.read(), nowMs);
    game.render();
  })(performance.now());
}
```

- [ ] **Step 5: 키보드로 실제 플레이해 확인한다**

```bash
.venv/bin/python manage.py runserver 8000
```

`http://localhost:8000/`을 열고 아래를 눈으로 확인한다.

- 레인 3개와 소실점으로 모이는 경계선이 보인다
- 장애물이 멀리서 작게 생겨 커지며 다가온다
- 화살표 좌/우로 캐릭터가 미끄러지듯 레인을 옮긴다
- 빨간 바리케이드는 위(↑ 또는 스페이스), 파란 가로보는 아래(↓)로 넘어간다
- 보라 기둥은 넘을 수 없고 레인을 바꿔야 한다
- 노란 코인을 먹으면 점수가 10 오른다
- 부딪히면 즉시 리셋된다
- 세 레인이 동시에 막혀 피할 수 없는 상황이 나오지 않는다

- [ ] **Step 6: `?test=1`이 여전히 통과하는지 확인한다**

`http://localhost:8000/?test=1`
Expected: `7 / 7 통과`

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 게임 루프와 키보드 조작 모드 추가"
```

---

### Task 5: PoseTracker + 디버그 패널

**Files:**
- Modify: `game/templates/index.html` — `(Task 5)` 마커 두 자리, `<style>`, `#stage` DOM, 임시 부트

**Interfaces:**
- Consumes: `createInputMapper` (Task 3), `createGame` / `createKeyboardSource` (Task 4)
- Produces:
  - `createPoseTracker() -> { start(videoEl) -> Promise<void>, read(nowMs) -> landmarks[]|null }`
  - `mountDebugPanel(mapper) -> { update(debug, lane, mode) }`

- [ ] **Step 1: DOM과 스타일을 추가한다**

`<style>` 블록 끝에 아래를 덧붙인다.

```css
    /* 웹캠은 거울이 아니다. 프리뷰를 뒤집어야 사용자의 왼쪽과 화면의 왼쪽이 맞는다 */
    #preview {
      position: absolute; right: 16px; bottom: 16px;
      width: 200px; border-radius: 10px; opacity: 0.75;
      transform: scaleX(-1); border: 1px solid rgba(255,255,255,0.15);
    }
    #debug {
      position: absolute; left: 16px; bottom: 16px;
      width: 260px; padding: 12px 14px; border-radius: 10px;
      background: rgba(8,12,26,0.85); border: 1px solid rgba(255,255,255,0.12);
      font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    #debug h3 { margin: 0 0 8px; font-size: 12px; letter-spacing: 0.04em; }
    #debug label { display: block; margin-top: 8px; }
    #debug input[type=range] { width: 100%; }
    #debug .row { display: flex; justify-content: space-between; }
    #debug .bad { color: #ff6b6b; }
    #debug .good { color: #7ef6a0; }
    #banner {
      position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
      padding: 10px 18px; border-radius: 999px; background: rgba(229,83,61,0.92);
      font-size: 14px; font-weight: 600; display: none;
    }
    .hidden { display: none !important; }
```

`#stage` 안의 `<canvas>` 뒤에 아래를 덧붙인다.

```html
    <video id="preview" playsinline muted class="hidden"></video>
    <div id="banner"></div>
    <div id="debug" class="hidden"></div>
```

- [ ] **Step 2: PoseTracker를 넣는다**

`// ── PoseTracker                      (Task 5)` 마커를 아래로 교체한다.

버전 0.10.35를 JS와 WASM 양쪽에 박는 것, 동적 import를 쓰는 것, 타임스탬프를 넘기는 것이 전부 필수다. Global Constraints에 근거가 있다.

```js
// ── PoseTracker — 카메라를 열고 랜드마크를 내보낸다. 게임의 존재를 모른다
const MP_VERSION = '0.10.35';
const MP_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MP_WASM = `${MP_MODULE}/wasm`;
const MP_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/' +
  'pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

function createPoseTracker() {
  let landmarker = null;
  let video = null;
  let lastVideoTime = -1;
  let lastLandmarks = null;

  async function loadLandmarker() {
    // UMD 빌드가 없어 ESM 동적 import 만 가능하다.
    // 정적 import 로 하면 CDN 실패 시 이 모듈 전체가 죽어 키보드 폴백까지 사라진다
    const mp = await import(MP_MODULE);
    const fileset = await mp.FilesetResolver.forVisionTasks(MP_WASM);
    return mp.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  async function start(videoEl) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    video = videoEl;
    landmarker = await loadLandmarker();
  }

  function read(nowMs) {
    if (!landmarker || !video || video.readyState < 2) return null;
    // detectForVideo 는 메인 스레드를 막는다. 새 프레임일 때만 부른다
    if (video.currentTime === lastVideoTime) return lastLandmarks;
    lastVideoTime = video.currentTime;
    // 타임스탬프는 필수다. 문서의 detectForVideo(video) 예제는 동작하지 않는다
    const result = landmarker.detectForVideo(video, nowMs);
    lastLandmarks =
      result.landmarks && result.landmarks.length > 0 ? result.landmarks[0] : null;
    return lastLandmarks;
  }

  return { start, read };
}
```

- [ ] **Step 3: 디버그 패널을 넣는다**

`// ── 디버그 패널                      (Task 5)` 마커를 아래로 교체한다.

이것은 speculative한 기능이 아니라 튜닝의 전제 조건이다. 없으면 숫자 수정 → 새로고침 → 물러나기 → 뛰기를 수십 번 반복해야 한다.

```js
// ── 디버그 패널 — 임계값은 몸으로 해보기 전에는 맞을 수 없다
const TUNABLES = [
  { key: 'jumpThreshold', label: '점프 임계', min: 0.05, max: 0.6, step: 0.01 },
  { key: 'slideThreshold', label: '슬라이드 임계', min: 0.1, max: 1.0, step: 0.01 },
  { key: 'baselineAlpha', label: '기준선 EMA', min: 0.0, max: 0.2, step: 0.005 },
  { key: 'laneAlpha', label: '레인 EMA', min: 0.05, max: 1.0, step: 0.05 },
  { key: 'visibilityMin', label: 'visibility 하한', min: 0.0, max: 0.9, step: 0.05 },
];

function mountDebugPanel(mapper) {
  const root = document.getElementById('debug');
  root.classList.remove('hidden');
  root.innerHTML = `
    <h3>디버그 (D 키로 토글)</h3>
    <div class="row"><span>점프량</span><span id="d-jump">-</span></div>
    <div class="row"><span>슬라이드량</span><span id="d-slide">-</span></div>
    <div class="row"><span>laneX</span><span id="d-lanex">-</span></div>
    <div class="row"><span>확정 레인</span><span id="d-lane">-</span></div>
    <div class="row"><span>발목 vis</span><span id="d-vis">-</span></div>
    <div class="row"><span>모드</span><span id="d-mode">-</span></div>
    ${TUNABLES.map((t) => `
      <label>${t.label} <span id="v-${t.key}">${mapper.cfg[t.key]}</span>
        <input type="range" id="s-${t.key}" min="${t.min}" max="${t.max}"
               step="${t.step}" value="${mapper.cfg[t.key]}" />
      </label>`).join('')}
  `;

  for (const t of TUNABLES) {
    const slider = root.querySelector(`#s-${t.key}`);
    const readout = root.querySelector(`#v-${t.key}`);
    slider.addEventListener('input', () => {
      const value = parseFloat(slider.value);
      mapper.cfg[t.key] = value;   // cfg 는 mapper 내부가 참조하는 바로 그 객체다
      readout.textContent = value;
    });
  }

  const el = (id) => root.querySelector(id);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') root.classList.toggle('hidden');
  });

  return {
    update(debug, lane, mode) {
      if (root.classList.contains('hidden')) return;
      el('#d-jump').textContent = debug.jumpAmount.toFixed(3);
      el('#d-slide').textContent = debug.slideAmount.toFixed(3);
      el('#d-lanex').textContent = debug.laneX.toFixed(3);
      el('#d-lane').textContent = lane;
      const vis = el('#d-vis');
      vis.textContent = debug.ankleVisibility.toFixed(2);
      vis.className = debug.ankleVisibility >= mapper.cfg.visibilityMin ? 'good' : 'bad';
      el('#d-mode').textContent = mode;
    },
  };
}
```

- [ ] **Step 4: 포즈 모드를 임시 부트에 붙인다**

Task 4의 임시 부트에서 `else` 블록 전체를 아래로 교체한다.

```js
} else {
  const banner = document.getElementById('banner');
  const preview = document.getElementById('preview');
  const game = createGame(canvas);
  const keyboard = createKeyboardSource();
  const mapper = createInputMapper();
  const tracker = createPoseTracker();
  const panel = mountDebugPanel(mapper);
  let mode = 'keyboard';

  function showBanner(text) {
    banner.textContent = text ?? '';
    banner.style.display = text ? 'block' : 'none';
  }

  // 카메라나 MediaPipe 가 죽어도 게임은 키보드로 계속 돌아야 한다
  (async () => {
    try {
      await tracker.start(preview);
      preview.classList.remove('hidden');
      mode = 'pose';
    } catch (e) {
      console.warn('포즈 모드 불가 — 키보드로 진행한다', e);
      showBanner('카메라를 쓸 수 없습니다. 화살표 키로 조작하세요');
      setTimeout(() => showBanner(null), 4000);
    }
  })();

  game.reset(1, performance.now());
  let calibratedAt = 0;

  (function loop(nowMs) {
    requestAnimationFrame(loop);

    let signal;
    if (mode === 'pose') {
      const lm = tracker.read(nowMs);
      // 임시 — Task 6 이 5초 카운트다운 캘리브레이션으로 교체한다
      if (!mapper.isCalibrated()) {
        if (lm) mapper.addCalibrationSample(lm);
        if (!calibratedAt) calibratedAt = nowMs + 3000;
        if (nowMs > calibratedAt) mapper.commitCalibration();
        showBanner('가만히 서 있으세요 — 캘리브레이션 중');
        game.render();
        return;
      }
      signal = mapper.update(lm, nowMs);
      showBanner(signal.warning);
      panel.update(mapper.getDebug(), signal.lane, 'pose');
    } else {
      signal = keyboard.read();
      panel.update(mapper.getDebug(), signal.lane, 'keyboard');
    }

    if (game.getState() === 'over') {
      keyboard.reset();
      game.reset(Math.floor(nowMs) % 100000, nowMs);
      return;
    }
    game.step(signal, nowMs);
    game.render();
  })(performance.now());
}
```

- [ ] **Step 5: 몸으로 확인하고 임계값을 튜닝한다**

```bash
.venv/bin/python manage.py runserver 8000
```

`http://localhost:8000/`을 열고 카메라를 허용한다. 1.5~2m 물러나 전신이 프리뷰에 들어오게 선다.

확인할 것.

- 프리뷰 속 나와 캐릭터가 **같은 방향으로** 움직인다. 반대로 가면 `laneX = 1 - x` 미러링이나 CSS `scaleX(-1)` 중 하나가 빠진 것이다
- 디버그 패널의 `발목 vis`가 실제 숫자로 뜨고 0이 아니다. 0.9 언저리가 정상이다
- 실제로 뛰면 `점프량`이 0.2를 넘고 캐릭터가 점프한다
- 쪼그리면 `슬라이드량`이 0.5를 넘고 캐릭터가 납작해진다
- 한 번 뛰었는데 두 번 세지 않는다
- 앞뒤로 걸어도 판정이 유지된다
- 카메라를 손으로 가리면 경고 배너가 뜬다

슬라이더로 임계값을 조정하고 **확정값을 `context-notes.md`에 기록한 뒤 `DEFAULT_CFG`에 반영한다.** 실측 없이 정한 시작값이라 거의 확실히 바뀐다.

- [ ] **Step 6: 폴백을 확인한다**

브라우저에서 카메라 권한을 거부한 뒤 새로고침한다.
Expected: 배너가 뜨고 화살표 키로 게임이 정상 동작한다. 콘솔에 경고만 있고 페이지가 죽지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: MediaPipe 포즈 추적과 디버그 패널 추가"
```

---

### Task 6: 화면 전환 + 점수 연동

**Files:**
- Modify: `game/templates/index.html` — `<style>`, `#stage` DOM, 부트 블록 전체

**Interfaces:**
- Consumes: 앞선 모든 태스크의 산출물, `GET /api/scores/`, `POST /api/scores/`
- Produces: 완성된 애플리케이션

- [ ] **Step 1: 화면 DOM과 스타일을 추가한다**

`<style>` 블록 끝에 아래를 덧붙인다.

```css
    .screen {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 18px;
      background: rgba(11,16,32,0.94); text-align: center; padding: 24px;
    }
    .screen h1 { margin: 0; font-size: 34px; letter-spacing: -0.02em; }
    .screen p { margin: 0; color: rgba(232,236,245,0.7); line-height: 1.7; }
    #nickname {
      padding: 12px 16px; width: 260px; font-size: 16px; text-align: center;
      border-radius: 10px; border: 1px solid rgba(255,255,255,0.2);
      background: rgba(255,255,255,0.06); color: #e8ecf5;
    }
    button {
      padding: 13px 30px; font-size: 16px; font-weight: 600; cursor: pointer;
      border-radius: 10px; border: 0; background: #7ef6a0; color: #08121f;
    }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    #ranking { list-style: none; padding: 0; margin: 0; width: 280px; }
    #ranking li {
      display: flex; justify-content: space-between; padding: 7px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 14px;
    }
    #count { font-size: 120px; font-weight: 700; line-height: 1; }
    #toast {
      position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
      padding: 10px 18px; border-radius: 999px; font-size: 14px;
      background: rgba(255,255,255,0.14); display: none;
    }
```

`#stage` 안, `#debug` 뒤에 아래를 덧붙인다.

```html
    <div id="start" class="screen">
      <h1>포즈 러너</h1>
      <p>앉아서 닉네임을 넣고 시작을 누르세요.<br />
         시작하면 5초 안에 1.5~2m 뒤로 물러나 전신이 보이게 서세요.</p>
      <input id="nickname" maxlength="12" placeholder="닉네임 (최대 12자)" />
      <button id="start-btn">시작</button>
      <h3 style="margin:8px 0 0">TOP 10</h3>
      <ol id="ranking"><li>불러오는 중…</li></ol>
      <p style="font-size:12px">카메라를 못 쓰면 화살표 키로 조작합니다. D 키로 디버그 패널.</p>
    </div>

    <div id="countdown" class="screen hidden">
      <p>뒤로 물러나 가만히 서세요</p>
      <div id="count">5</div>
      <p>이 자세를 기준으로 잡습니다</p>
    </div>

    <div id="gameover" class="screen hidden">
      <h1 id="final-score">0점</h1>
      <p id="submit-state">점수를 보내는 중…</p>
    </div>

    <div id="toast"></div>
```

- [ ] **Step 2: 부트 블록을 완성본으로 교체한다**

`// ── 화면 전환·API·부트               (Task 6)` 마커부터 `</script>` 직전까지 전체를 아래로 교체한다. Task 4·5의 임시 부트를 지우는 것이다.

```js
// ── 화면 전환·API·부트
const canvas = document.getElementById('canvas');

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── API — 시트는 부가 기능이다. 실패해도 게임은 계속 간다
const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]').content;
const API_SCORES = '/api/scores/';

async function fetchTopScores() {
  const res = await fetch(API_SCORES);
  if (!res.ok) throw new Error('랭킹 조회 실패');
  return (await res.json()).scores;
}

async function submitScore(nickname, score) {
  const res = await fetch(API_SCORES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
    body: JSON.stringify({ nickname, score }),
  });
  if (!res.ok) throw new Error('점수 전송 실패');
}

function boot() {
  const el = (id) => document.getElementById(id);
  const startScreen = el('start');
  const countdownScreen = el('countdown');
  const gameoverScreen = el('gameover');
  const banner = el('banner');
  const toast = el('toast');
  const preview = el('preview');

  const game = createGame(canvas);
  const keyboard = createKeyboardSource();
  const mapper = createInputMapper();
  const tracker = createPoseTracker();
  const panel = mountDebugPanel(mapper);

  let mode = 'keyboard';
  let phase = 'start';
  let countdownEndMs = 0;
  let nickname = '플레이어';

  // show(null) 이면 셋 다 숨는다 — 플레이 중에는 화면 오버레이가 없다
  const show = (screen) => {
    for (const s of [startScreen, countdownScreen, gameoverScreen]) {
      s.classList.toggle('hidden', s !== screen);
    }
  };

  function showBanner(text) {
    banner.textContent = text ?? '';
    banner.style.display = text ? 'block' : 'none';
  }

  function showToast(text) {
    toast.textContent = text;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
  }

  async function loadRanking() {
    const list = el('ranking');
    try {
      const scores = await fetchTopScores();
      list.innerHTML = scores.length
        ? scores.map((s, i) =>
            `<li><span>${i + 1}. ${escapeHtml(s.nickname)}</span><span>${s.score}</span></li>`
          ).join('')
        : '<li>아직 기록이 없습니다</li>';
    } catch {
      list.innerHTML = '<li>불러올 수 없음</li>';
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 카메라와 MediaPipe 는 시작 화면을 보는 동안 미리 띄운다
  (async () => {
    try {
      await tracker.start(preview);
      preview.classList.remove('hidden');
      mode = 'pose';
    } catch (e) {
      console.warn('포즈 모드 불가 — 키보드로 진행한다', e);
      showToast('카메라를 쓸 수 없습니다. 화살표 키로 조작하세요');
    }
  })();

  el('start-btn').addEventListener('click', () => {
    nickname = el('nickname').value.trim().slice(0, 12) || '플레이어';
    phase = 'countdown';
    countdownEndMs = performance.now() + 5000;
    show(countdownScreen);
  });

  el('nickname').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('start-btn').click();
  });

  async function finishGame() {
    phase = 'gameover';
    const score = game.getScore();
    el('final-score').textContent = `${score}점`;
    el('submit-state').textContent = '점수를 보내는 중…';
    show(gameoverScreen);
    try {
      await submitScore(nickname, score);
      el('submit-state').textContent = '기록했습니다';
    } catch {
      el('submit-state').textContent = '점수를 보내지 못했습니다';
    }
    setTimeout(async () => {
      phase = 'start';
      keyboard.reset();
      show(startScreen);
      await loadRanking();
    }, 2500);
  }

  function loop(nowMs) {
    requestAnimationFrame(loop);
    const landmarks = mode === 'pose' ? tracker.read(nowMs) : null;

    if (phase === 'countdown') {
      const left = Math.max(0, countdownEndMs - nowMs);
      el('count').textContent = Math.ceil(left / 1000);
      if (mode === 'pose' && landmarks) mapper.addCalibrationSample(landmarks);
      if (left <= 0) {
        if (mode === 'pose' && !mapper.commitCalibration()) {
          // 5초 동안 몸을 한 번도 못 찾았다. 포즈 조작이 불가능하다
          mode = 'keyboard';
          showToast('몸을 찾지 못했습니다. 화살표 키로 조작하세요');
        }
        phase = 'playing';
        show(null);
        game.reset(Math.floor(nowMs) % 100000, nowMs);
      }
      return;
    }

    if (phase !== 'playing') return;

    let signal;
    if (mode === 'pose') {
      signal = mapper.update(landmarks, nowMs);
      showBanner(signal.warning);
    } else {
      signal = keyboard.read();
    }
    panel.update(mapper.getDebug(), signal.lane, mode);

    game.step(signal, nowMs);
    game.render();

    if (game.getState() === 'over') {
      showBanner(null);
      finishGame();
    }
  }

  show(startScreen);
  loadRanking();
  requestAnimationFrame(loop);
}

// 부트 분기는 파일 맨 끝이어야 한다. 위로 올리면 boot() 이 아직 초기화되지 않은
// const CSRF_TOKEN / API_SCORES 를 읽어 TDZ ReferenceError 가 난다
if (new URLSearchParams(location.search).get('test') === '1') {
  renderSelfTests(runSelfTests());
} else {
  boot();
}
```

- [ ] **Step 3: 시트 자격증명을 설정한다**

Google Cloud 콘솔에서 서비스 계정을 만들고 JSON 키를 `credentials.json`으로 프로젝트 루트에 둔다. 스프레드시트를 만들고 1행에 `nickname`, `score`, `played_at` 헤더를 넣은 뒤 서비스 계정 이메일에 편집 권한을 공유한다.

```bash
export SHEET_ID="<스프레드시트 URL의 /d/ 와 /edit 사이 문자열>"
.venv/bin/python manage.py runserver 8000
```

`credentials.json`이 `.gitignore`에 있는지 확인한다. 이미 들어 있다.

- [ ] **Step 4: 전체 흐름을 확인한다**

`http://localhost:8000/`에서 아래를 순서대로 확인한다.

- 시작 화면에 TOP 10이 뜬다. 시트가 비어 있으면 "아직 기록이 없습니다"가 뜬다
- 닉네임을 넣고 시작을 누르면 5초 카운트다운이 돈다
- 카운트다운 동안 물러나 서면 그 자세가 기준선이 된다
- 플레이가 되고 부딪히면 점수가 뜬다
- "기록했습니다"가 뜨고 시작 화면으로 돌아가면 랭킹에 내 점수가 있다

- [ ] **Step 5: 시트 없이도 게임이 도는지 확인한다**

```bash
SHEET_ID="" .venv/bin/python manage.py runserver 8000
```

Expected: 랭킹 자리에 "불러올 수 없음"이 뜨지만 게임은 정상 플레이되고, 게임오버 시 "점수를 보내지 못했습니다"만 뜨고 시작 화면으로 돌아온다. **게임이 죽지 않는다.**

- [ ] **Step 6: 전체 테스트를 돌린다**

Run: `.venv/bin/pytest -q`
Expected: `8 passed`

`http://localhost:8000/?test=1`
Expected: `7 / 7 통과`

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 시작 화면과 랭킹 연동으로 전체 흐름 완성"
```

---

## 완료 기준

- [ ] `.venv/bin/pytest -q` → 8 passed
- [ ] `/?test=1` → 7 / 7 통과
- [ ] 카메라로 좌우 이동·점프·슬라이드가 모두 동작한다
- [ ] 카메라를 거부해도 화살표 키로 완주할 수 있다
- [ ] 시트가 죽어도 게임이 죽지 않는다
- [ ] 실측 튜닝한 임계값이 `DEFAULT_CFG`에 반영되고 `context-notes.md`에 근거가 남았다
- [ ] `credentials.json`이 커밋되지 않았다 — `git log --all --stat | grep credentials`가 비어 있다

## 알려진 미해결 사항

- **임계값은 반드시 실측으로 바뀐다.** 계획서의 시작값은 계산으로 낸 값이라 몸에 맞을 확률이 낮다. Task 5 Step 5가 이 작업이다.
- **`visibility`가 가림 상황에서 실제로 떨어지는지는 미확인이다.** 값이 채워지는 것과 0.941~0.99999로 변동하는 것은 확인했지만, 검증 대상이 전신이 보이는 상태였다. 발목이 가려질 때 0.5 아래로 떨어지는지는 Task 5에서 카메라를 손으로 가려 직접 봐야 한다. 임계값 0.5도 그때 조정한다.
- **전신 모드는 사용자가 2m 뒤에서 화면을 봐야 한다.** 실사용은 외부 모니터나 TV 미러링을 권장하지만 코드가 요구하는 사항은 아니다.

## 명시적 비범위

배포·HTTPS·프로덕션 설정, 사용자 계정 및 인증, 서버 사이드 점수 검증, 캐릭터 스프라이트 및 사운드, 목숨 시스템·파워업, 모바일 대응.
