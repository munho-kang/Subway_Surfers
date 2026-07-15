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
