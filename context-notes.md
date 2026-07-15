# 컨텍스트 노트

## 착수 전 검증으로 확정된 사실 (2026-07-15)

- MediaPipe tasks-vision **0.10.35**. UMD 빌드가 없어 ESM만 가능하다. 공식 문서의
  `<script src>` 예제는 `SyntaxError`가 나고 전역을 만들지 않는다.
- 랜드마크 `visibility`는 채워진다. 설계 문서가 남긴 미확인 사항은 해소됐고 대체 수단은
  필요 없다. 값이 안 온다는 보고는 2023년 이슈이며 PR #5142로 2024-03에 수정됐다.
  실측 범위 0.941~0.99999. `presence`는 JS API에 없다.
- `detectForVideo`는 타임스탐프가 필수이고 동기로 반환한다. 문서 예제가 틀렸다.
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
