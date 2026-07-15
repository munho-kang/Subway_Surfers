# index.html 서빙과 랭킹 조회/등록 뷰
from django.shortcuts import render


def index(request):
    return render(request, "index.html")
