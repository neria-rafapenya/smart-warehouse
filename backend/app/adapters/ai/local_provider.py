from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from statistics import median
from typing import Sequence


def _number(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _round(value: float) -> float:
    return round(value, 2)


class LocalDeterministicAIProvider:
    """Motor reproducible basado en reglas y estadística descriptiva local."""

    name = "local_deterministic_v1"

    def detect_anomalies(self, orders: Sequence[dict]) -> dict:
        by_sku: dict[str, list[dict]] = defaultdict(list)
        for order in orders:
            by_sku[str(order.get("sku") or "unknown")].append(order)

        findings = []
        for index, order in enumerate(orders):
            sku = str(order.get("sku") or "unknown")
            finding_id = order.get("external_id") or f"{sku}-{index}"
            peers = [item for item in by_sku[sku] if item is not order]
            quantities = [_number(item.get("requested_quantity")) for item in peers if _number(item.get("requested_quantity")) > 0]
            prices = [_number(item.get("unit_price")) for item in peers if _number(item.get("unit_price")) > 0]
            quantity = _number(order.get("requested_quantity"))
            price = _number(order.get("unit_price"))
            reference_quantity = median(quantities) if quantities else _number(order.get("historical_average"))
            reference_price = median(prices) if prices else price
            demand = _number(order.get("demand_quantity"))
            reasons = []
            if reference_quantity and quantity > reference_quantity * 5:
                reasons.append(f"Volumen {quantity:g} uds. frente a una mediana de {reference_quantity:g}")
            if demand and quantity > demand * 2:
                reasons.append(f"La demanda prevista ({demand:g}) no justifica {quantity:g} uds.")
            if reference_price and price > reference_price * 1.25:
                reasons.append(f"Precio unitario {price:.2f} EUR, un {((price / reference_price) - 1) * 100:.1f}% sobre la referencia")
            if not reasons:
                continue
            severity = "critical" if len(reasons) >= 2 else "warning"
            findings.append({
                "order_id": finding_id,
                "sku": sku,
                "product": order.get("product"),
                "severity": severity,
                "risk": "red" if severity == "critical" else "yellow",
                "requested_quantity": quantity,
                "reference_quantity": _round(reference_quantity),
                "unit_price": _round(price),
                "reference_unit_price": _round(reference_price),
                "reasons": reasons,
                "suggestion": "Revisión humana antes de aprobar el pedido y confirmar el precio con el proveedor.",
            })
        return {"engine": self.name, "count": len(findings), "findings": findings}

    def forecast_demand(self, orders: Sequence[dict], sku: str | None = None) -> dict:
        selected = [order for order in orders if not sku or str(order.get("sku")) == sku]
        monthly: dict[str, float] = defaultdict(float)
        for order in selected:
            requested_at = order.get("requested_at")
            if isinstance(requested_at, (datetime, date)):
                month = requested_at.strftime("%Y-%m")
            else:
                month = str(requested_at or "unknown")[:7]
            monthly[month] += _number(order.get("requested_quantity"))
        values = list(monthly.values())
        average = sum(values[-3:]) / len(values[-3:]) if values else 0
        return {
            "engine": self.name,
            "sku": sku,
            "period": "next_30_days",
            "forecast_quantity": _round(average),
            "historical_months": [{"month": month, "quantity": _round(quantity)} for month, quantity in sorted(monthly.items())],
            "method": "media de los tres últimos meses disponibles; determinista",
            "explanation": "La previsión usa el histórico local y no invoca un modelo externo.",
        }

    def compare_suppliers(self, suppliers: Sequence[dict]) -> dict:
        candidates = []
        for supplier in suppliers:
            rating = _number(supplier.get("rating"))
            lead_time = _number(supplier.get("lead_time_days"))
            rating_score = min(max(rating / 5, 0), 1)
            lead_score = 1 / max(lead_time, 1)
            score = (rating_score * 0.7) + (lead_score * 0.3)
            candidates.append({
                "code": supplier.get("code"),
                "supplier": supplier.get("legal_name"),
                "rating": rating,
                "lead_time_days": lead_time,
                "orders_count": int(_number(supplier.get("orders_count"))),
                "score": _round(score),
                "reason": f"Valoración {rating:.1f}/5 y plazo de {lead_time:g} días; ponderación 70% valoración y 30% plazo.",
            })
        candidates.sort(key=lambda item: (-item["score"], item["lead_time_days"], item["supplier"] or ""))
        return {"engine": self.name, "ranking": candidates, "method": "ranking explicable por valoración y plazo"}

    def suggestions(self, orders: Sequence[dict], stock: Sequence[dict]) -> dict:
        low_stock = [item for item in stock if item.get("status") == "replenish"]
        anomalies = self.detect_anomalies(orders)["findings"]
        suggestions = []
        for item in low_stock[:10]:
            suggestions.append({
                "type": "replenishment",
                "severity": "warning",
                "sku": item.get("sku"),
                "message": f"Revisar reposición de {item.get('product')}; stock {item.get('quantity')} por debajo del mínimo {item.get('minimum_quantity')}.",
                "reason": "Stock actual inferior al mínimo configurado.",
            })
        for finding in anomalies[:10]:
            suggestions.append({"type": "order_review", "severity": finding["severity"], "sku": finding["sku"], "message": finding["suggestion"], "reason": "; ".join(finding["reasons"])})
        return {"engine": self.name, "count": len(suggestions), "suggestions": suggestions}

    def chat(self, message: str, context: dict) -> dict:
        query = message.lower().strip()
        orders = context.get("orders", [])
        stock = context.get("stock", [])
        suppliers = context.get("suppliers", [])
        events = context.get("events", [])
        if any(word in query for word in ("stock", "inventario", "existencias")):
            low = [item for item in stock if item.get("status") == "replenish"]
            answer = f"He encontrado {len(low)} referencias por debajo del mínimo." if low else "No he encontrado referencias por debajo del mínimo configurado."
            return {"engine": self.name, "answer": answer, "data": low[:10], "sources": ["stock_items"]}
        if any(word in query for word in ("proveedor", "proveedores")):
            ranking = self.compare_suppliers(suppliers)["ranking"][:5]
            return {"engine": self.name, "answer": "Ranking determinista de proveedores por valoración y plazo de entrega.", "data": ranking, "sources": ["suppliers"]}
        if any(word in query for word in ("evento", "alerta", "incidencia")):
            return {"engine": self.name, "answer": f"Hay {len(events)} eventos recientes en el registro.", "data": events[:10], "sources": ["audit_events"]}
        risky = [order for order in orders if order.get("risk") in ("red", "yellow") or order.get("status") in ("blocked", "human_review")]
        return {
            "engine": self.name,
            "answer": f"He revisado los datos locales. Hay {len(risky)} pedidos con riesgo o revisión pendiente.",
            "data": risky[:10],
            "sources": ["orders", "validation_decisions"],
            "next_questions": ["¿Qué stock está bajo mínimos?", "¿Qué proveedor tiene mejor valoración?", "¿Qué eventos críticos hay?"],
        }
