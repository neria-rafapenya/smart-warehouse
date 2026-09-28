from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .adapters.inbound.api import build_router
from .adapters.ai.local_provider import LocalDeterministicAIProvider
from .adapters.outbound.mysql_repository import MySQLWarehouseRepository
from .application.ai_service import AIService
from .application.integrations import IntegrationService
from .application.auth import decode_token, has_permission
from .application.services import WarehouseService
from .config.settings import get_settings


class AuthorizationMiddleware(BaseHTTPMiddleware):
    """Protege la API y traduce rutas de negocio a permisos funcionales."""

    def __init__(self, app, settings, repository_provider):
        super().__init__(app)
        self.settings = settings
        self.repository_provider = repository_provider

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        public = (path.endswith("/health") or path.endswith("/auth/login") or path.endswith("/openapi.json") or path.startswith("/docs") or path.startswith("/redoc"))
        # El navegador necesita completar el preflight CORS antes de enviar
        # Authorization; nunca debe requerir token ni permisos.
        if request.method == "OPTIONS" or public:
            return await call_next(request)
        authorization = request.headers.get("Authorization", "")
        token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
        claims = decode_token(token, self.settings.auth_secret)
        if not claims:
            return JSONResponse(status_code=401, content={"detail": "Autenticación requerida"})
        user = self.repository_provider().get_user(int(claims["sub"]))
        if not user or not user.get("active"):
            return JSONResponse(status_code=401, content={"detail": "Usuario no disponible"})
        permission = self._permission_for(path, request.method)
        if permission and not has_permission(user, permission):
            return JSONResponse(status_code=403, content={"detail": f"Permiso requerido: {permission}"})
        request.state.user = user
        return await call_next(request)

    @staticmethod
    def _permission_for(path: str, method: str) -> str | None:
        if "/ai/" in path:
            return "ai.run" if method != "GET" and path.endswith(("/run", "/chat")) else "ai.read"
        if "/sandbox" in path:
            return "warehouse.write" if method not in {"GET", "HEAD"} else "warehouse.read"
        if "/integrations" in path:
            return "administration.write" if method not in {"GET", "HEAD"} else "administration.read"
        if "/events" in path or "/alerts" in path:
            return "administration.write" if method in {"POST", "PATCH", "DELETE"} and "/alert-rules" in path else "audit.read"
        if "/alert-rules" in path:
            return "administration.write" if method != "GET" else "administration.read"
        if "/stock" in path or "/receipts" in path:
            return "warehouse.write" if method not in {"GET", "HEAD"} else "warehouse.read"
        if "/orders" in path or "/imports" in path or "/suppliers" in path or "/documents" in path:
            return "purchasing.write" if method not in {"GET", "HEAD"} else "purchasing.read"
        if "/dashboard" in path:
            return "warehouse.read"
        return None


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

    def integration_service_provider() -> IntegrationService:
        return IntegrationService(MySQLWarehouseRepository(settings))

    app.add_middleware(AuthorizationMiddleware, settings=settings, repository_provider=lambda: MySQLWarehouseRepository(settings))
    app.include_router(build_router(service_provider, settings.environment, ai_service_provider, lambda: MySQLWarehouseRepository(settings), settings.auth_secret, settings.auth_token_ttl_seconds, integration_service_provider), prefix=settings.api_prefix)
    return app


app = create_app()
