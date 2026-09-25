"""Puertos de salida para desacoplar casos de uso de MySQL, S3, ERP o WMS."""
from typing import Protocol, Iterable

class OrderRepository(Protocol):
    def list_pending(self) -> Iterable[dict]: ...

class DocumentRepository(Protocol):
    def save_extracted_invoice(self, invoice: dict) -> str: ...

class DecisionPublisher(Protocol):
    def publish(self, event: dict) -> None: ...

class AccountingExporter(Protocol):
    def export_invoice(self, invoice: dict) -> dict: ...
