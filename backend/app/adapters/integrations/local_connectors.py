from datetime import datetime, timezone


class LocalCorporateConnector:
    """Simula conectores sin red para probar contratos y trazabilidad."""

    def __init__(self, code: str, kind: str):
        self.code = code
        self.kind = kind

    def healthcheck(self, configuration: dict) -> dict:
        return {"status": "available", "mode": "local_simulation", "endpoint": configuration.get("endpoint"), "checked_at": datetime.now(timezone.utc).isoformat()}

    def sync(self, direction: str, configuration: dict, payload: dict | None = None) -> dict:
        return {"status": "simulated", "direction": direction, "records": int((payload or {}).get("records", 0)), "connector": self.code, "mode": "local_simulation"}


def connector_for(code: str, kind: str) -> LocalCorporateConnector:
    return LocalCorporateConnector(code, kind)
