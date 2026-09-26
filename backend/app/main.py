from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .adapters.inbound.api import build_router
from .adapters.ai.local_provider import LocalDeterministicAIProvider
from .adapters.outbound.mysql_repository import MySQLWarehouseRepository
from .application.ai_service import AIService
from .application.services import WarehouseService
from .config.settings import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="REST API hexagonal para Smart Warehouse.",
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["*"],
    )

    def service_provider() -> WarehouseService:
        return WarehouseService(MySQLWarehouseRepository(settings))

    def ai_service_provider() -> AIService:
        return AIService(MySQLWarehouseRepository(settings), LocalDeterministicAIProvider())

    app.include_router(build_router(service_provider, settings.environment, ai_service_provider), prefix=settings.api_prefix)
    return app


app = create_app()
