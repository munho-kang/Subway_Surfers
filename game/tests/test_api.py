# 랭킹 API와 index 서빙에 대한 테스트. gspread는 모킹한다
import json
from unittest.mock import MagicMock, patch

from game import sheets


def test_index_returns_html(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"<canvas" in response.content


def test_index_embeds_csrf_token(client):
    response = client.get("/")
    assert b'name="csrf-token"' in response.content
    assert b'content=""' not in response.content


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


def test_post_rejects_non_object_json_body(client):
    worksheet = _mock_worksheet()
    with patch.object(sheets, "_worksheet", return_value=worksheet):
        # Test with null
        response = client.post(
            "/api/scores/",
            data="null",
            content_type="application/json",
        )
    assert response.status_code == 400
    assert worksheet.append_row.call_count == 0

    with patch.object(sheets, "_worksheet", return_value=worksheet):
        # Test with list
        response = client.post(
            "/api/scores/",
            data=json.dumps([1, 2, 3]),
            content_type="application/json",
        )
    assert response.status_code == 400
    assert worksheet.append_row.call_count == 0


def test_sheet_failure_becomes_error_response_not_crash(client):
    with patch.object(sheets, "_worksheet", side_effect=RuntimeError("시트 접근 불가")):
        response = client.get("/api/scores/")
    assert response.status_code == 503
    assert "error" in response.json()
