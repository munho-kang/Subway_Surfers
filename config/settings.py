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
