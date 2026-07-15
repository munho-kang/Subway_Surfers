# 게임 앱 URL 라우팅
from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
]
