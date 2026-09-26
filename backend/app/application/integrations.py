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
