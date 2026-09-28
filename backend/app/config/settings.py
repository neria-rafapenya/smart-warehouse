from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Smart Warehouse API"
    api_prefix: str = "/api/v1"
    environment: str = "local"
    mysql_host: str = "127.0.0.1"
    mysql_port: int = 3306
    mysql_database: str = "smart_warehouse"
    mysql_user: str = "root"
    mysql_password: str = "root"
    mysql_use_pure: bool = True
    local_storage_path: str = "backend/storage"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    auth_secret: str = "local-only-change-before-production"
    auth_token_ttl_seconds: int = 28800
    ai_provider: str = "local"
    ai_external_enabled: bool = False
    aws_region: str = "eu-west-1"
    bedrock_model_id: str = ""
    ai_max_tokens: int = 1200
    ai_temperature: float = 0.1

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
