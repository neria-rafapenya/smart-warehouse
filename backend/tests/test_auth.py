from app.application.auth import create_token, decode_token, hash_password, has_permission, verify_password


def test_password_hash_and_token_roundtrip():
    user = {"id": 7, "email": "demo@local", "permissions": ["ai.read"]}
    assert verify_password("demo1234", hash_password("demo1234"))
    assert not verify_password("incorrecta", hash_password("demo1234"))
    token = create_token(user, "test-secret", ttl_seconds=60)
    claims = decode_token(token, "test-secret")
    assert claims["sub"] == 7
    assert decode_token(token, "wrong-secret") is None
    assert has_permission(user, "ai.read")
    assert not has_permission(user, "administration.write")
