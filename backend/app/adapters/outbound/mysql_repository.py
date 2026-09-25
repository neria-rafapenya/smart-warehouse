import json
from datetime import datetime
from collections.abc import Sequence
from typing import Any

import mysql.connector

from ...config.settings import Settings


class MySQLWarehouseRepository:
    """MySQL adapter. SQL stays here so use cases remain storage-agnostic."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def _connect(self):
        return mysql.connector.connect(
            host=self.settings.mysql_host,
            port=self.settings.mysql_port,
            database=self.settings.mysql_database,
            user=self.settings.mysql_user,
            password=self.settings.mysql_password,
            use_pure=self.settings.mysql_use_pure,
        )

    def _fetch_all(self, query: str, params: tuple[Any, ...] = ()) -> list[dict]:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute(query, params)
            return list(cursor.fetchall())
        finally:
            cursor.close()
            connection.close()

    def count(self, table: str) -> int:
        allowed = {"orders", "stock_items", "suppliers", "notifications"}
        if table not in allowed:
            raise ValueError(f"Unsupported count table: {table}")
        result = self._fetch_all(f"SELECT COUNT(*) AS total FROM {table}")
        return int(result[0]["total"])

    def list_orders(self, status: str | None = None) -> Sequence[dict]:
        query = """
            SELECT o.external_id, o.status, o.risk, o.currency, o.total,
                   o.requested_at, u.full_name AS requester,
                   s.legal_name AS supplier, p.description AS product,
                   ol.requested_quantity, ol.unit_price,
                   COALESCE(si.quantity, 0) AS available_stock,
                   COALESCE(si.minimum_quantity, 0) AS minimum_stock
            FROM orders o
            LEFT JOIN users u ON u.id = o.requester_id
            LEFT JOIN suppliers s ON s.id = o.supplier_id
            LEFT JOIN order_lines ol ON ol.order_id = o.id
            LEFT JOIN products p ON p.id = ol.product_id
            LEFT JOIN stock_items si ON si.product_id = ol.product_id AND si.warehouse_id = o.warehouse_id
        """
        params: tuple[Any, ...] = ()
        if status:
            query += " WHERE o.status = %s"
            params = (status,)
        query += " ORDER BY o.requested_at DESC"
        return self._fetch_all(query, params)

    def get_order(self, external_id: str) -> dict | None:
        rows = self._fetch_all(
            """
            SELECT o.external_id, o.status, o.risk, o.currency, o.total,
                   o.requested_at, u.full_name AS requester,
                   s.legal_name AS supplier, p.description AS product,
                   ol.requested_quantity, ol.unit_price,
                   COALESCE(si.quantity, 0) AS available_stock,
                   COALESCE(si.minimum_quantity, 0) AS minimum_stock,
                   24 AS historical_average, 18 AS demand_quantity,
                   EXISTS (SELECT 1 FROM order_procedures op WHERE op.order_id = o.id AND op.status = 'complete') AS required_document_present
            FROM orders o
            LEFT JOIN users u ON u.id = o.requester_id
            LEFT JOIN suppliers s ON s.id = o.supplier_id
            LEFT JOIN order_lines ol ON ol.order_id = o.id
            LEFT JOIN products p ON p.id = ol.product_id
            LEFT JOIN stock_items si ON si.product_id = ol.product_id AND si.warehouse_id = o.warehouse_id
            WHERE o.external_id = %s
            LIMIT 1
            """,
            (external_id,),
        )
        return rows[0] if rows else None

    def list_stock(self) -> Sequence[dict]:
        return self._fetch_all(
            """
            SELECT p.sku, p.description AS product, p.category,
                   si.quantity, si.minimum_quantity, si.reserved_quantity,
                   sl.code AS location, sl.zone,
                   CASE WHEN si.quantity < si.minimum_quantity THEN 'replenish' ELSE 'optimal' END AS status
            FROM stock_items si
            JOIN products p ON p.id = si.product_id
            LEFT JOIN storage_locations sl ON sl.id = si.location_id
            ORDER BY status DESC, p.description
            """
        )

    def list_suppliers(self) -> Sequence[dict]:
        return self._fetch_all(
            """
            SELECT s.code, s.legal_name, s.category, s.rating, s.lead_time_days,
                   s.status, COUNT(DISTINCT o.id) AS orders_count
            FROM suppliers s
            LEFT JOIN orders o ON o.supplier_id = s.id
            GROUP BY s.id
            ORDER BY s.legal_name
            """
        )

    def list_invoices(self) -> Sequence[dict]:
        return self._fetch_all(
            """
            SELECT i.invoice_number, s.legal_name AS supplier, i.invoice_date,
                   i.total, i.currency, i.status, d.extraction_status, d.confidence
            FROM invoices i
            LEFT JOIN suppliers s ON s.id = i.supplier_id
            LEFT JOIN documents d ON d.id = i.document_id
            ORDER BY i.created_at DESC
            """
        )

    def list_receipts(self) -> Sequence[dict]:
        return self._fetch_all(
            """
            SELECT gr.receipt_number, gr.dock_code, gr.status, gr.expected_at,
                   o.external_id, s.legal_name AS supplier, p.description AS product,
                   ol.requested_quantity AS quantity
            FROM goods_receipts gr
            LEFT JOIN orders o ON o.id = gr.order_id
            LEFT JOIN suppliers s ON s.id = o.supplier_id
            LEFT JOIN order_lines ol ON ol.order_id = o.id
            LEFT JOIN products p ON p.id = ol.product_id
            ORDER BY gr.expected_at
            """
        )

    def list_events(self, limit: int = 50) -> Sequence[dict]:
        safe_limit = max(1, min(limit, 200))
        return self._fetch_all(
            f"""SELECT id, event_type, severity, aggregate_type, aggregate_id,
                       actor_type, payload, created_at
                FROM audit_events ORDER BY created_at DESC LIMIT {safe_limit}"""
        )

    def save_validation(self, external_id: str, decision: dict) -> None:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute("SELECT id FROM orders WHERE external_id = %s", (external_id,))
            order = cursor.fetchone()
            if not order:
                return
            cursor.execute(
                "INSERT INTO validation_decisions (order_id, decision_status, risk, confidence, reasons) VALUES (%s, %s, %s, %s, %s)",
                (order["id"], decision["status"], decision["risk"], 1.0, json.dumps(decision["reasons"], ensure_ascii=False))
            )
            connection.commit()
        finally:
            cursor.close()
            connection.close()

    def create_order(self, payload: dict) -> dict:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            external_id = payload.get("external_order_id") or f"PED-LOCAL-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            requester_email = payload.get("requester_email", "laura.martin@smartwarehouse.local")
            cursor.execute("SELECT id FROM users WHERE email = %s LIMIT 1", (requester_email,))
            requester = cursor.fetchone()
            cursor.execute("SELECT id FROM suppliers WHERE code = %s LIMIT 1", (payload["supplier_code"],))
            supplier = cursor.fetchone()
            cursor.execute("SELECT id FROM warehouses WHERE code = %s LIMIT 1", (payload.get("warehouse_code", "MAD-01"),))
            warehouse = cursor.fetchone()
            cursor.execute("SELECT id FROM products WHERE sku = %s LIMIT 1", (payload["sku"],))
            product = cursor.fetchone()
            if not all([requester, supplier, warehouse, product]):
                raise ValueError("requester_email, supplier_code, warehouse_code or sku not found")

            quantity = float(payload["quantity"])
            unit_price = float(payload["unit_price"])
            total = round(quantity * unit_price, 2)
            cursor.execute(
                """INSERT INTO orders (external_id, order_type, status, risk, requester_id, supplier_id, warehouse_id, subtotal, tax_amount, total, requested_at)
                   VALUES (%s, 'purchase_request', 'pending', 'yellow', %s, %s, %s, %s, %s, %s, NOW())
                   ON DUPLICATE KEY UPDATE total = VALUES(total), updated_at = CURRENT_TIMESTAMP""",
                (external_id, requester["id"], supplier["id"], warehouse["id"], round(total / 1.21, 2), round(total - total / 1.21, 2), total),
            )
            cursor.execute("SELECT id FROM orders WHERE external_id = %s", (external_id,))
            order = cursor.fetchone()
            cursor.execute(
                """INSERT INTO order_lines (order_id, product_id, requested_quantity, unit_price, line_total)
                   VALUES (%s, %s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE requested_quantity = VALUES(requested_quantity), unit_price = VALUES(unit_price), line_total = VALUES(line_total)""",
                (order["id"], product["id"], quantity, unit_price, total),
            )
            connection.commit()
            return {"external_id": external_id, "status": "pending", "risk": "yellow", "total": total}
        except Exception:
            connection.rollback()
            raise
        finally:
            cursor.close()
            connection.close()

    def import_orders(self, rows: list[dict]) -> dict:
        imported, errors = [], []
        for index, row in enumerate(rows, start=2):
            try:
                imported.append(self.create_order(row))
            except Exception as error:
                errors.append({"row": index, "message": str(error)})
        return {"imported": imported, "imported_count": len(imported), "errors": errors, "error_count": len(errors)}
