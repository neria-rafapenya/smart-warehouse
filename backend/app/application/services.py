from .validate_order import ValidationDecision, validate_order
from ..domain.errors import OrderNotFoundError
from ..domain.ports import WarehouseRepository


class WarehouseService:
    """Use cases independent from FastAPI and the MySQL adapter."""

    def __init__(self, repository: WarehouseRepository):
        self.repository = repository

    def dashboard(self) -> dict:
        pending_orders = list(self.repository.list_orders(status="pending"))
        return {
            "orders_pending": len(pending_orders),
            "stock_items": self.repository.count("stock_items"),
            "active_suppliers": self.repository.count("suppliers"),
            "unread_notifications": self.repository.count("notifications"),
            "orders": pending_orders,
            "stock": list(self.repository.list_stock()),
            "events": list(self.repository.list_events(limit=10)),
        }

    def orders(self, status: str | None = None) -> list[dict]:
        return list(self.repository.list_orders(status=status))

    def order(self, external_id: str) -> dict:
        result = self.repository.get_order(external_id)
        if result is None:
            raise OrderNotFoundError(external_id)
        return result

    def validate(self, external_id: str) -> ValidationDecision:
        order = self.order(external_id)
        decision = validate_order(
            requested_qty=int(order["requested_quantity"]),
            historical_average=int(order.get("historical_average", 0)),
            available_stock=int(order.get("available_stock", 0)),
            demand_qty=int(order.get("demand_quantity", 0)),
            required_document_present=bool(order.get("required_document_present", False)),
        )
        self.repository.save_validation(external_id, decision.as_dict())
        return decision

    def stock(self) -> list[dict]:
        return list(self.repository.list_stock())

    def suppliers(self) -> list[dict]:
        return list(self.repository.list_suppliers())

    def invoices(self) -> list[dict]:
        return list(self.repository.list_invoices())

    def reconcile_invoice(self, invoice_number: str) -> dict:
        return self.repository.reconcile_invoice(invoice_number)

    def accounting_export_rows(self) -> list[dict]:
        return list(self.repository.accounting_export_rows())

    def mark_invoice_exported(self, invoice_number: str, export_format: str, target_system: str) -> dict:
        return self.repository.mark_invoice_exported(invoice_number, export_format, target_system)

    def procedures(self, external_id: str | None = None) -> list[dict]:
        return list(self.repository.list_procedures(external_id=external_id))

    def save_invoice_document(self, filename: str, mime_type: str, content: bytes, extracted: dict) -> dict:
        return self.repository.save_invoice_document(filename, mime_type, content, extracted)

    def save_procedure_document(self, external_id: str, procedure_code: str, filename: str, mime_type: str, content: bytes) -> dict:
        return self.repository.save_procedure_document(external_id, procedure_code, filename, mime_type, content)

    def receipts(self) -> list[dict]:
        return list(self.repository.list_receipts())

    def create_receipt(self, payload: dict) -> dict:
        return self.repository.create_receipt(payload)

    def events(self, limit: int = 50, severity: str | None = None, event_type: str | None = None, aggregate_type: str | None = None) -> list[dict]:
        return list(self.repository.list_events(limit=limit, severity=severity, event_type=event_type, aggregate_type=aggregate_type))

    def event(self, event_id: int) -> dict:
        result = self.repository.get_event(event_id)
        if result is None:
            raise ValueError(f"Evento no encontrado: {event_id}")
        return result

    def alerts(self, limit: int = 50, severity: str | None = None, event_type: str | None = None, status: str = "unread") -> list[dict]:
        return list(self.repository.list_alerts(limit=limit, severity=severity, event_type=event_type, status=status))

    def mark_alert_read(self, alert_id: int) -> dict:
        return self.repository.mark_alert_read(alert_id)

    def mark_all_alerts_read(self) -> int:
        return self.repository.mark_all_alerts_read()

    def alert_rules(self) -> list[dict]:
        return list(self.repository.list_alert_rules())

    def create_alert_rule(self, payload: dict) -> dict:
        return self.repository.create_alert_rule(payload)

    def update_alert_rule(self, rule_id: int, payload: dict) -> dict:
        return self.repository.update_alert_rule(rule_id, payload)

    def decisions(self, external_id: str) -> list[dict]:
        return list(self.repository.list_decisions(external_id))

    def create_order(self, payload: dict) -> dict:
        return self.repository.create_order(payload)

    def import_orders(self, rows: list[dict]) -> dict:
        return self.repository.import_orders(rows)
