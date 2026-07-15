# 루트 URL 라우팅
from django.urls import include, path

urlpatterns = [
    path("", include("game.urls")),
]
