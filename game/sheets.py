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
