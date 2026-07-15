# 랭킹 API와 index 서빙에 대한 테스트. gspread는 모킹한다
def test_index_returns_html(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"<canvas" in response.content


def test_index_embeds_csrf_token(client):
    response = client.get("/")
    assert b'name="csrf-token"' in response.content
    assert b'content=""' not in response.content
