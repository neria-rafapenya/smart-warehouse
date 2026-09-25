"""Caso de uso determinista de validación; la futura IA se integra detrás del mismo puerto."""
from dataclasses import dataclass

@dataclass
class ValidationDecision:
    status: str
    risk: str
    reasons: list[str]

def validate_order(*, requested_qty: int, historical_average: int, available_stock: int,
                   demand_qty: int, required_document_present: bool) -> ValidationDecision:
    reasons: list[str] = []
    if historical_average and requested_qty > historical_average * 5:
        reasons.append("Volumen superior a 5x la media histórica")
    if requested_qty > max(demand_qty * 2, 1):
        reasons.append("La demanda prevista no justifica el volumen")
    if not required_document_present:
        reasons.append("Falta documentación obligatoria del proceso")
    if len(reasons) >= 2:
        return ValidationDecision("blocked", "red", reasons)
    if reasons:
        return ValidationDecision("human_review", "yellow", reasons)
    return ValidationDecision("approved", "green", ["Stock, demanda e histórico compatibles"])
