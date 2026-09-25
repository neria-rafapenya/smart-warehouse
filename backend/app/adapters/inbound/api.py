import csv
import io
import re
from typing import Annotated, Callable

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from openpyxl import load_workbook
from pypdf import PdfReader
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


def _amount(value: str) -> float | None:
    normalized = value.replace("€", "").replace("EUR", "").replace(" ", "").strip()
    if not normalized:
        return None
    if "," in normalized and "." in normalized:
        normalized = normalized.replace(".", "").replace(",", ".")
    else:
        normalized = normalized.replace(",", ".")
    try:
        return round(float(normalized), 2)
    except ValueError:
        return None


def _extract_invoice(content: bytes) -> dict:
    try:
        reader = PdfReader(io.BytesIO(content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"No se pudo leer el PDF: {error}") from error

    invoice_match = re.search(r"(?:factura|invoice)\s*(?:n[ºo°.]?|number|no\.?)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]+)", text, re.IGNORECASE)
    date_match = re.search(r"(?:fecha|date)\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", text, re.IGNORECASE)
    tax_id_match = re.search(r"\b([A-Z]\d{8}|\d{8}[A-Z])\b", text.upper())
    total_match = re.search(r"(?:total(?:\s+factura)?|importe\s+total)\s*[:#-]?\s*([0-9][0-9., ]*)", text, re.IGNORECASE)
    subtotal_match = re.search(r"(?:subtotal|base\s+imponible)\s*[:#-]?\s*([0-9][0-9., ]*)", text, re.IGNORECASE)
    tax_match = re.search(r"(?:iva|impuestos?|tax)\s*[:#-]?\s*([0-9][0-9., ]*)", text, re.IGNORECASE)
    invoice_date = None
    if date_match:
        day, month, year = re.split(r"[/-]", date_match.group(1))
        invoice_date = f"{int(year):04d}-{int(month):02d}-{int(day):02d}" if len(year) == 4 else f"20{int(year):02d}-{int(month):02d}-{int(day):02d}"
    extracted = {
        "supplier_tax_id": tax_id_match.group(1) if tax_id_match else None,
        "invoice_number": invoice_match.group(1).upper() if invoice_match else None,
        "invoice_date": invoice_date,
        "currency": "EUR",
        "subtotal": _amount(subtotal_match.group(1)) if subtotal_match else None,
        "tax": _amount(tax_match.group(1)) if tax_match else None,
        "total": _amount(total_match.group(1)) if total_match else None,
        "pages": len(reader.pages),
        "text_detected": bool(text.strip()),
    }
    required = ("supplier_tax_id", "invoice_number", "invoice_date", "total")
    complete = bool(text.strip()) and all(extracted.get(field) not in (None, "") for field in required)
    extracted["extraction_status"] = "extracted" if complete else "needs_review"
    extracted["confidence"] = 0.96 if complete else (0.45 if text.strip() else 0.0)
    return extracted


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

    @router.get("/orders/{external_id}/decisions", tags=["orders"])
    def decisions(external_id: str, current: Annotated[WarehouseService, Depends(service)]):
        return current.decisions(external_id)

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

    @router.post("/documents/invoices", status_code=201, tags=["documents"])
    async def upload_invoice(file: UploadFile = File(...), current: WarehouseService = Depends(service)):
        filename = file.filename or "invoice.pdf"
        if not filename.lower().endswith(".pdf") and file.content_type != "application/pdf":
            raise HTTPException(status_code=415, detail="Solo se admiten facturas PDF")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=422, detail="La factura está vacía")
        extracted = _extract_invoice(content)
        try:
            return current.save_invoice_document(filename, file.content_type or "application/pdf", content, extracted)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @router.get("/documents/procedures", tags=["documents"])
    def procedures(current: Annotated[WarehouseService, Depends(service)]):
        return current.procedures()

    @router.get("/orders/{external_id}/procedures", tags=["documents"])
    def order_procedures(external_id: str, current: Annotated[WarehouseService, Depends(service)]):
        return current.procedures(external_id=external_id)

    @router.post("/orders/{external_id}/procedures/{procedure_code}/documents", status_code=201, tags=["documents"])
    async def upload_procedure_document(external_id: str, procedure_code: str, file: UploadFile = File(...), current: WarehouseService = Depends(service)):
        filename = file.filename or "procedure-document"
        content = await file.read()
        if not content:
            raise HTTPException(status_code=422, detail="El documento está vacío")
        try:
            return current.save_procedure_document(external_id, procedure_code, filename, file.content_type or "application/octet-stream", content)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @router.get("/receipts", tags=["receiving"])
    def receipts(current: Annotated[WarehouseService, Depends(service)]):
        return current.receipts()

    @router.get("/events", tags=["events"])
    def events(current: Annotated[WarehouseService, Depends(service)], limit: int = Query(default=50, ge=1, le=200)):
        return current.events(limit=limit)

    @router.get("/alerts", tags=["events"])
    def alerts(current: Annotated[WarehouseService, Depends(service)], limit: int = Query(default=50, ge=1, le=200)):
        return current.alerts(limit=limit)

    return router
