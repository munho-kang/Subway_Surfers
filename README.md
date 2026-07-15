# 포즈 러너

포즈로 조작하는 3레인 엔드리스 러너다. 카메라 앞 1.5~2m 에 서서 실제로 걷고, 뛰고,
쪼그려서 장애물을 피한다. 카메라가 없거나 몸을 못 찾으면 화살표 키로도 플레이할 수 있다.

## 설치

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Google Sheets 설정 (선택)

랭킹을 저장하고 불러오려면 Google Sheets 연동이 필요하다. **연동 없이도 게임은 정상적으로
플레이할 수 있다** — 시트를 설정하지 않으면 랭킹 목록에 "불러올 수 없음"이 표시될 뿐이다.

1. Google Cloud 콘솔에서 서비스 계정을 만들고 JSON 키를 발급받는다.
2. 발급받은 키를 프로젝트 루트에 `credentials.json` 으로 저장한다 (`.gitignore`에 이미
   포함돼 있어 커밋되지 않는다).
3. Google Sheets에 새 스프레드시트를 만들고, 1행에 헤더 `nickname | score | played_at`
   를 넣는다.
4. 스프레드시트를 서비스 계정 이메일(JSON 키 안의 `client_email`)과 공유한다.
5. 시트 URL의 `/d/`와 `/edit` 사이 문자열을 `SHEET_ID` 환경변수로 export 한다.

```bash
export SHEET_ID="..."
```

## 실행

```bash
SHEET_ID="..." .venv/bin/python manage.py runserver 8000
```

브라우저에서 `http://localhost:8000/` 을 연다.

## 조작

카메라가 있으면 몸으로, 없거나 몸을 못 찾으면 화살표 키로 조작한다.

- 좌우 이동: 몸을 좌우로 옮기기 / `←` `→`
- 점프: 제자리에서 뛰기 / `↑` 또는 `Space`
- 슬라이드: 쪼그리기 / `↓`
- `D` 키: 디버그 패널 토글

## 테스트

```bash
.venv/bin/pytest -q
```

`http://localhost:8000/?test=1` 을 열면 InputMapper 셀프 테스트 결과를 볼 수 있다.

## 설계 문서

설계와 계획의 전체 맥락은 `docs/superpowers/specs/`와 `docs/superpowers/plans/`에 있다.

## 참고

`DEFAULT_CFG`의 점프/슬라이드 임계값은 검증되지 않은 초기값이다. 실제 카메라와 몸으로
디버그 패널을 보면서 튜닝이 필요하다.
