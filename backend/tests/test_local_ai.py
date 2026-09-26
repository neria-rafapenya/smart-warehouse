from app.adapters.ai.local_provider import LocalDeterministicAIProvider


def test_local_provider_detects_volume_and_price_anomaly():
    provider = LocalDeterministicAIProvider()
    orders = [
        {"external_id": "PED-1", "sku": "SKU-1", "requested_quantity": 20, "unit_price": 10, "demand_quantity": 20},
        {"external_id": "PED-2", "sku": "SKU-1", "requested_quantity": 250, "unit_price": 20, "demand_quantity": 20},
    ]

    result = provider.detect_anomalies(orders)

    assert result["engine"] == "local_deterministic_v1"
    assert result["count"] == 1
    assert result["findings"][0]["order_id"] == "PED-2"
    assert len(result["findings"][0]["reasons"]) >= 2


def test_local_provider_forecasts_from_available_months():
    provider = LocalDeterministicAIProvider()
    result = provider.forecast_demand([
        {"sku": "SKU-1", "requested_quantity": 10, "requested_at": "2025-01-02"},
        {"sku": "SKU-1", "requested_quantity": 20, "requested_at": "2025-02-02"},
    ], sku="SKU-1")

    assert result["forecast_quantity"] == 15
    assert result["period"] == "next_30_days"


def test_local_provider_chat_uses_context_sources():
    provider = LocalDeterministicAIProvider()
    result = provider.chat("¿Qué stock está bajo mínimos?", {"stock": [{"sku": "SKU-1", "status": "replenish"}], "orders": [], "suppliers": [], "events": []})

    assert "mínimo" in result["answer"]
    assert result["sources"] == ["stock_items"]
