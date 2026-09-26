"""Autenticación local y autorización por permisos.

El token está firmado con un secreto local y no depende de AWS ni de un
proveedor externo. En producción podrá sustituirse por OIDC/JWT corporativo
sin cambiar los casos de uso.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"{_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        salt_value, digest_value = encoded.split("$", 1)
        salt = _unb64(salt_value)
        expected = _unb64(digest_value)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return hmac.compare_digest(actual, expected)


def create_token(user: dict[str, Any], secret: str, ttl_seconds: int = 8 * 3600) -> str:
    header = _json_b64({"alg": "HS256", "typ": "SWWT"})
    payload = _json_b64({"sub": int(user["id"]), "email": user["email"], "exp": int(time.time()) + ttl_seconds})
    signature = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64(signature)}"


def decode_token(token: str, secret: str) -> dict[str, Any] | None:
    try:
        header, payload, signature = token.split(".", 2)
        expected = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_unb64(signature), expected):
            return None
        data = json.loads(_unb64(payload))
        if int(data.get("exp", 0)) < int(time.time()):
            return None
        return data
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def has_permission(user: dict[str, Any], permission: str) -> bool:
    return permission in set(user.get("permissions", []))


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _json_b64(value: dict[str, Any]) -> str:
    return _b64(json.dumps(value, separators=(",", ":")).encode())
