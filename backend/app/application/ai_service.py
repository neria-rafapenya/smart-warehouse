from __future__ import annotations

from ..domain.ports import AIProvider, WarehouseRepository


class AIService:
    """Casos de uso de IA; el proveedor puede ser local, Bedrock u otro adaptador."""

    def __init__(self, repository: WarehouseRepository, provider: AIProvider, context_provider=None):
        self.repository = repository
        self.provider = provider
        self.context_provider = context_provider

    def _context(self) -> dict:
        if self.context_provider:
            return self.context_provider()
        return {
            "orders": list(self.repository.list_orders()),
            "stock": list(self.repository.list_stock()),
            "suppliers": list(self.repository.list_suppliers()),
            "events": list(self.repository.list_events(limit=20)),
        }

    def anomalies(self, persist: bool = False) -> dict:
        context = self._context()
        result = self.provider.detect_anomalies(context["orders"])
        if persist:
            for finding in result["findings"]:
                self.repository.record_ai_event(
                    event_type="ai.anomaly_detected",
                    severity=finding["severity"],
                    aggregate_type="order",
                    aggregate_id=finding["order_id"],
                    payload=finding,
                    notify=True,
                    title="Anomalía de pedido detectada",
                    body=f"{finding['order_id']}: {'; '.join(finding['reasons'])}",
                )
        return result | {"persisted": persist}

    def demand(self, sku: str | None = None) -> dict:
        return self.provider.forecast_demand(self._context()["orders"], sku)

    def suppliers(self) -> dict:
        return self.provider.compare_suppliers(self._context()["suppliers"])

    def suggestions(self, persist: bool = False) -> dict:
        context = self._context()
        result = self.provider.suggestions(context["orders"], context["stock"])
        if persist:
            for suggestion in result["suggestions"]:
                self.repository.record_ai_event(
                    event_type="ai.suggestion",
                    severity=suggestion["severity"],
                    aggregate_type="product" if suggestion.get("sku") else "warehouse",
                    aggregate_id=suggestion.get("sku") or "MAD-01",
                    payload=suggestion,
                    notify=suggestion["severity"] == "critical",
                    title="Sugerencia operativa de IA",
                    body=suggestion["message"],
                )
        return result | {"persisted": persist}

    def chat(self, message: str) -> dict:
        context = self._context()
        result = self.provider.chat(message, context)
        self.repository.record_ai_event(
            event_type="ai.chat_query",
            severity="info",
            aggregate_type="assistant",
            aggregate_id="copilot",
            payload={"message": message, "answer": result.get("answer"), "sources": result.get("sources", [])},
            notify=False,
        )
        return result
