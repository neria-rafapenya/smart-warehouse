import csv
import io
from typing import Annotated, Callable

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from openpyxl import load_workbook
from pydantic import BaseModel, Field

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


class CreateOrderRequest(BaseModel):
    sku: str
    quantity: float = Field(gt=0)
    unit_price: float = Field(gt=0)
    supplier_code: str
    warehouse_code: str = "MAD-01"
    requester_email: str = "laura.martin@smartwarehouse.local"
    external_order_id: str | None = None


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

    @router.post("/orders", status_code=201, tags=["orders"])
    def create_order(payload: CreateOrderRequest, current: Annotated[WarehouseService, Depends(service)]):
        try:
            return current.create_order(payload.model_dump())
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @router.post("/imports/orders", tags=["imports"])
    async def import_orders(file: UploadFile = File(...), current: WarehouseService = Depends(service)):
        filename = (file.filename or "").lower()
        content = await file.read()
        if filename.endswith(".csv"):
            rows = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))
        elif filename.endswith(".xlsx"):
            workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            sheet = workbook.active
            values = list(sheet.values)
            headers = [str(value).strip() if value is not None else "" for value in values[0]] if values else []
            rows = [dict(zip(headers, row)) for row in values[1:]]
        else:
            raise HTTPException(status_code=415, detail="Solo se admiten archivos .csv o .xlsx")

        aliases = {"ref": "sku", "sku": "sku", "producto": "product_description", "descripción": "product_description", "descripcion": "product_description", "cant.": "quantity", "cantidad": "quantity", "unidades": "quantity", "precio": "unit_price", "precio unitario": "unit_price", "proveedor": "supplier_code", "supplier_code": "supplier_code", "external_order_id": "external_order_id"}
        normalized = []
        for row in rows:
            mapped = {}
            for key, value in row.items():
                mapped[aliases.get(str(key).strip().lower(), str(key).strip())] = value
            if not mapped.get("sku") and not mapped.get("product_description"):
                continue
            if not mapped.get("sku") and mapped.get("product_description"):
                raise HTTPException(status_code=422, detail="La plantilla necesita SKU para localizar el producto")
            mapped["quantity"] = float(mapped.get("quantity", 0))
            mapped["unit_price"] = float(mapped.get("unit_price", 0))
            mapped.setdefault("supplier_code", "SALTOKI")
            normalized.append(mapped)
        return current.import_orders(normalized)

    @router.get("/stock", tags=["stock"])
    def stock(current: Annotated[WarehouseService, Depends(service)]):
        return current.stock()

    @router.get("/suppliers", tags=["suppliers"])
    def suppliers(current: Annotated[WarehouseService, Depends(service)]):
        return current.suppliers()

    @router.get("/documents/invoices", tags=["documents"])
    def invoices(current: Annotated[WarehouseService, Depends(service)]):
        return current.invoices()

    @router.get("/receipts", tags=["receiving"])
    def receipts(current: Annotated[WarehouseService, Depends(service)]):
        return current.receipts()

    @router.get("/events", tags=["events"])
    def events(current: Annotated[WarehouseService, Depends(service)], limit: int = Query(default=50, ge=1, le=200)):
        return current.events(limit=limit)

    return router
