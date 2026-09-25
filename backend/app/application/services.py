from .validate_order import ValidationDecision, validate_order
from ..domain.errors import OrderNotFoundError
from ..domain.ports import WarehouseRepository


class WarehouseService:
    """Use cases independent from FastAPI and the MySQL adapter."""

    def __init__(self, repository: WarehouseRepository):
        self.repository = repository

    def dashboard(self) -> dict:
        return {
            "orders_pending": self.repository.count("orders"),
            "stock_items": self.repository.count("stock_items"),
            "active_suppliers": self.repository.count("suppliers"),
            "unread_notifications": self.repository.count("notifications"),
            "orders": list(self.repository.list_orders(status="pending")),
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

    def events(self, limit: int = 50) -> list[dict]:
        return list(self.repository.list_events(limit=limit))
