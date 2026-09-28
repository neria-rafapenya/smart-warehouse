from __future__ import annotations

import json
from datetime import date, datetime
from typing import Sequence


class BedrockAIProvider:
    """Proveedor remoto opcional; solo se instancia con la bandera externa activa."""

    name = "bedrock_on_demand"

    def __init__(self, model_id: str, region_name: str, max_tokens: int = 1200, temperature: float = 0.1):
        if not model_id:
            raise RuntimeError("BEDROCK_MODEL_ID es obligatorio cuando la IA externa está activa")
        try:
            import boto3
        except ImportError as error:
            raise RuntimeError("Instala boto3 para activar el proveedor Bedrock") from error
        self.model_id = model_id
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.client = boto3.client("bedrock-runtime", region_name=region_name)

    def _ask_json(self, instruction: str, payload: object) -> dict:
        response = self.client.converse(
            modelId=self.model_id,
            system=[{"text": "Responde únicamente con JSON válido. No inventes datos. Basa tus conclusiones solo en el contexto recibido."}],
            messages=[{"role": "user", "content": [{"text": f"{instruction}\nCONTEXTO:\n{json.dumps(payload, ensure_ascii=False, default=self._json_default)}"}]}],
            inferenceConfig={"maxTokens": self.max_tokens, "temperature": self.temperature},
        )
        text = "".join(part.get("text", "") for part in response["output"]["message"]["content"])
        text = text.strip().removeprefix("```json").removesuffix("```").strip()
        return json.loads(text)

    @staticmethod
    def _json_default(value: object):
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        raise TypeError(f"Tipo no serializable: {type(value).__name__}")

    def detect_anomalies(self, orders: Sequence[dict]) -> dict:
        result = self._ask_json(
            "Analiza pedidos. Devuelve {engine,count,findings}. Cada finding debe incluir order_id, sku, product, severity (critical o warning), risk (red o yellow), requested_quantity, reference_quantity, unit_price, reference_unit_price, reasons (array) y suggestion. Devuelve solo anomalías explicables.",
            list(orders),
        )
        result["engine"] = self.name
        result.setdefault("count", len(result.get("findings", [])))
        return result

    def forecast_demand(self, orders: Sequence[dict], sku: str | None = None) -> dict:
        result = self._ask_json(
            "Calcula la demanda de los próximos 30 días. Devuelve sku, period, forecast_quantity, historical_months (array con month y quantity), method y explanation.",
            {"sku": sku, "orders": list(orders)},
        )
        result["engine"] = self.name
        return result

    def compare_suppliers(self, suppliers: Sequence[dict]) -> dict:
        result = self._ask_json(
            "Compara proveedores por valoración, plazo y datos disponibles. Devuelve engine, ranking (array) y method. No inventes proveedores ni métricas.",
            list(suppliers),
        )
        result["engine"] = self.name
        return result

    def suggestions(self, orders: Sequence[dict], stock: Sequence[dict]) -> dict:
        result = self._ask_json(
            "Propón acciones operativas explicables para pedidos y stock. Devuelve engine, count y suggestions. Cada sugerencia debe incluir type, severity, sku, message y reason.",
            {"orders": list(orders), "stock": list(stock)},
        )
        result["engine"] = self.name
        result.setdefault("count", len(result.get("suggestions", [])))
        return result

    def chat(self, message: str, context: dict) -> dict:
        result = self._ask_json(
            "Responde a la pregunta del usuario sobre la operación del almacén. Devuelve answer, data (array), sources (array) y opcionalmente next_questions (array). Cita las fuentes de datos usadas.",
            {"message": message, "context": context},
        )
        result["engine"] = self.name
        return result
