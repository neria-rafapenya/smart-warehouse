from typing import Annotated, Callable

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...application.services import WarehouseService
from ...domain.errors import OrderNotFoundError


class ValidationResponse(BaseModel):
    status: str
    risk: str
    reasons: list[str]


class HealthResponse(BaseModel):
    status: str
    service: str
    environment: str


def build_router(service_provider: Callable[[], WarehouseService], environment: str) -> APIRouter:
    router = APIRouter()

    def service() -> WarehouseService:
        return service_provider()

    @router.get("/health", response_model=HealthResponse, tags=["system"])
    def health() -> HealthResponse:
        return HealthResponse(status="ok", service="smart-warehouse-api", environment=environment)

    @router.get("/dashboard", tags=["dashboard"])
    def dashboard(current: Annotated[WarehouseService, Depends(service)]):
        return current.dashboard()

    @router.get("/orders", tags=["orders"])
    def orders(current: Annotated[WarehouseService, Depends(service)], status: str | None = Query(default=None)):
        return current.orders(status=status)

    @router.get("/orders/{external_id}", tags=["orders"])
    def order(external_id: str, current: Annotated[WarehouseService, Depends(service)]):
        try:
            return current.order(external_id)
        except OrderNotFoundError as error:
            raise HTTPException(status_code=404, detail=f"Order {external_id} not found") from error

    @router.post("/orders/{external_id}/validate", response_model=ValidationResponse, tags=["orders"])
    def validate_order(external_id: str, current: Annotated[WarehouseService, Depends(service)]):
        try:
            return current.validate(external_id)
        except OrderNotFoundError as error:
            raise HTTPException(status_code=404, detail=f"Order {external_id} not found") from error

    @router.get("/stock", tags=["stock"])
    def stock(current: Annotated[WarehouseService, Depends(service)]):
        return current.stock()

    @router.get("/suppliers", tags=["suppliers"])
    def suppliers(current: Annotated[WarehouseService, Depends(service)]):
        return current.suppliers()

    @router.get("/documents/invoices", tags=["documents"])
    def invoices(current: Annotated[WarehouseService, Depends(service)]):
        return current.invoices()

    @router.get("/events", tags=["events"])
    def events(current: Annotated[WarehouseService, Depends(service)], limit: int = Query(default=50, ge=1, le=200)):
        return current.events(limit=limit)

    return router
