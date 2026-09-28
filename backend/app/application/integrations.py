from datetime import datetime, timezone
from typing import List

from ..adapters.integrations.local_connectors import connector_for
from ..domain.ports import WarehouseRepository


class IntegrationService:
    def __init__(self, repository: WarehouseRepository):
        self.repository = repository

    def list(self) -> list[dict]:
        return list(self.repository.list_integrations())

    def health(self) -> List[dict]:
        result = []
        for integration in self.list():
            connector = connector_for(integration["code"], integration["kind"])
            result.append({**integration, "health": connector.healthcheck(integration.get("configuration") or {})})
        return result

    def sync(self, code: str, direction: str = "outbound") -> dict:
        integration = next((item for item in self.list() if item["code"] == code), None)
        if not integration:
            raise ValueError(f"Integración no encontrada: {code}")
        connector = connector_for(code, integration["kind"])
        result = connector.sync(direction, integration.get("configuration") or {}, {"records": 0})
        return self.repository.record_integration_sync(code, direction, result)

    def sandbox_snapshot(self) -> dict:
        """Expose a stable ERP/WMS-shaped contract for local integration demos."""
        stock = list(self.repository.list_stock())
        orders = list(self.repository.list_orders())
        suppliers = list(self.repository.list_suppliers())
        movements = list(self.repository.list_stock_movements(limit=200))
        receipts = list(self.repository.list_receipts())
        return {
            "source": "smart-warehouse-local-sandbox",
            "version": "2026-01",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "products": [
                {"sku": item.get("sku"), "name": item.get("description") or item.get("product"), "unit": "unit"}
                for item in stock
            ],
            "inventory": [
                {"sku": item.get("sku"), "warehouse": item.get("warehouse_code") or item.get("warehouse"), "quantity": item.get("quantity"), "minimum_quantity": item.get("minimum_quantity")}
                for item in stock
            ],
            "sales": [
                {"id": item.get("reference_id") or item.get("id"), "sku": item.get("sku"), "quantity": item.get("quantity"), "occurred_at": item.get("created_at")}
                for item in movements if item.get("movement_type") == "exit"
            ],
            "purchase_orders": [
                {"id": item.get("external_id"), "status": item.get("status"), "sku": item.get("sku"), "quantity": item.get("requested_quantity"), "supplier": item.get("supplier"), "requested_at": item.get("requested_at")}
                for item in orders
            ],
            "suppliers": [
                {"code": item.get("code"), "name": item.get("legal_name"), "status": item.get("status")}
                for item in suppliers
            ],
            "receipts": [
                {"number": item.get("receipt_number"), "order_id": item.get("external_id"), "status": item.get("status"), "received_at": item.get("received_at")}
                for item in receipts
            ],
        }

    def sandbox_resource(self, resource: str) -> list[dict]:
        snapshot = self.sandbox_snapshot()
        resources = {
            "products": snapshot["products"],
            "inventory": snapshot["inventory"],
            "sales": snapshot["sales"],
            "purchase-orders": snapshot["purchase_orders"],
            "suppliers": snapshot["suppliers"],
            "receipts": snapshot["receipts"],
        }
        if resource not in resources:
            raise ValueError(f"Recurso sandbox no disponible: {resource}")
        return resources[resource]
