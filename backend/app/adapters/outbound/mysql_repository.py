import json
from datetime import datetime
from collections.abc import Sequence
from pathlib import Path
import re
from typing import Any
from uuid import uuid4

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

    def authenticate_user(self, email: str) -> dict | None:
        rows = self._fetch_all(
            """SELECT u.id, u.full_name, u.email, u.role, u.active, u.password_hash,
                      GROUP_CONCAT(DISTINCT p.code) AS permissions,
                      GROUP_CONCAT(DISTINCT w.code) AS warehouses
               FROM users u
               LEFT JOIN role_permissions rp ON rp.role = u.role
               LEFT JOIN permissions p ON p.id = rp.permission_id
               LEFT JOIN user_warehouses uw ON uw.user_id = u.id
               LEFT JOIN warehouses w ON w.id = uw.warehouse_id
               WHERE LOWER(u.email) = LOWER(%s)
               GROUP BY u.id LIMIT 1""",
            (email,),
        )
        if not rows:
            return None
        user = rows[0]
        user["permissions"] = [item for item in (user.get("permissions") or "").split(",") if item]
        user["warehouses"] = [item for item in (user.get("warehouses") or "").split(",") if item]
        return user

    def get_user(self, user_id: int) -> dict | None:
        rows = self._fetch_all(
            """SELECT u.id, u.full_name, u.email, u.role, u.active,
                      GROUP_CONCAT(DISTINCT p.code) AS permissions,
                      GROUP_CONCAT(DISTINCT w.code) AS warehouses
               FROM users u
               LEFT JOIN role_permissions rp ON rp.role = u.role
               LEFT JOIN permissions p ON p.id = rp.permission_id
               LEFT JOIN user_warehouses uw ON uw.user_id = u.id
               LEFT JOIN warehouses w ON w.id = uw.warehouse_id
               WHERE u.id = %s GROUP BY u.id LIMIT 1""",
            (user_id,),
        )
        if not rows:
            return None
        user = rows[0]
        user["permissions"] = [item for item in (user.get("permissions") or "").split(",") if item]
        user["warehouses"] = [item for item in (user.get("warehouses") or "").split(",") if item]
        return user

    def record_user_login(self, user_id: int, success: bool, email: str) -> None:
        connection = self._connect()
        cursor = connection.cursor()
        try:
            payload = json.dumps({"email": email, "success": success}, ensure_ascii=False)
            cursor.execute(
                """INSERT INTO audit_events
                   (event_type, severity, aggregate_type, aggregate_id, actor_type, actor_id, payload)
                   VALUES (%s, %s, 'user', %s, 'user', %s, %s)""",
                ("auth.login" if success else "auth.login_failed", "info" if success else "warning", str(user_id), user_id, payload),
            )
            connection.commit()
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
            SELECT o.external_id, o.title, o.status, o.risk, o.currency, o.total,
                   o.requested_at, u.full_name AS requester,
                   s.legal_name AS supplier, p.sku, p.description AS product,
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
            SELECT o.external_id, o.title, o.status, o.risk, o.currency, o.total,
                   o.requested_at, u.full_name AS requester,
                   s.legal_name AS supplier, p.sku, p.description AS product,
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

    def transition_order_status(self, external_id: str, to_status: str, reason: str | None = None) -> dict:
        allowed = {
            "pending": set(), "human_review": set(), "blocked": {"pending"},
            "validated": {"approved", "pending"}, "approved": {"sent_to_supplier"},
            "sent_to_supplier": {"received"}, "received": {"closed"}, "closed": set(),
        }
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute("SELECT id, status, requester_id FROM orders WHERE external_id = %s LIMIT 1 FOR UPDATE", (external_id,))
            order = cursor.fetchone()
            if not order:
                raise ValueError(f"Pedido no encontrado: {external_id}")
            if to_status not in allowed.get(order["status"], set()):
                raise ValueError(f"Transición no permitida: {order['status']} → {to_status}")
            if to_status == "approved":
                cursor.execute(
                    """SELECT COUNT(*) AS total_required,
                              SUM(CASE WHEN op.status = 'complete' THEN 1 ELSE 0 END) AS completed_required
                       FROM order_procedures op
                       JOIN required_procedures rp ON rp.id = op.procedure_id
                       WHERE op.order_id = %s AND rp.active = TRUE""",
                    (order["id"],),
                )
                documents = cursor.fetchone() or {}
                total_required = int(documents.get("total_required") or 0)
                completed_required = int(documents.get("completed_required") or 0)
                if completed_required < total_required:
                    raise ValueError(f"No se puede aprobar el pedido: faltan {total_required - completed_required} documentos obligatorios")
            if to_status == "received":
                cursor.execute(
                    "SELECT COUNT(*) AS total FROM goods_receipts WHERE order_id = %s AND status IN ('received', 'discrepancy', 'complete')",
                    (order["id"],),
                )
                if int((cursor.fetchone() or {}).get("total") or 0) == 0:
                    raise ValueError("No se puede marcar recibido: registra primero la recepción de almacén")
            if to_status == "closed":
                cursor.execute(
                    "SELECT COUNT(*) AS total FROM goods_receipts WHERE order_id = %s AND status IN ('received', 'discrepancy', 'complete')",
                    (order["id"],),
                )
                if int((cursor.fetchone() or {}).get("total") or 0) == 0:
                    raise ValueError("No se puede cerrar el pedido: falta la recepción de almacén")
                cursor.execute(
                    """SELECT COUNT(*) AS total
                       FROM invoice_reconciliations ir
                       WHERE ir.order_id = %s AND ir.status = 'matched'""",
                    (order["id"],),
                )
                if int((cursor.fetchone() or {}).get("total") or 0) == 0:
                    raise ValueError("No se puede cerrar el pedido: falta una factura conciliada correctamente")
            cursor.execute("UPDATE orders SET status = %s, approved_at = CASE WHEN %s = 'approved' THEN NOW() ELSE approved_at END WHERE id = %s", (to_status, to_status, order["id"]))
            cursor.execute("INSERT INTO order_status_history (order_id, from_status, to_status, reason, created_by) VALUES (%s, %s, %s, %s, (SELECT id FROM users WHERE email = 'laura.martin@smartwarehouse.local' LIMIT 1))", (order["id"], order["status"], to_status, reason))
            payload = json.dumps({"from_status": order["status"], "to_status": to_status, "reason": reason}, ensure_ascii=False)
            cursor.execute("INSERT INTO audit_events (event_type, severity, aggregate_type, aggregate_id, actor_type, payload) VALUES ('order.status_changed', 'info', 'order', %s, 'user', %s)", (external_id, payload))
            connection.commit()
            return {"external_id": external_id, "from_status": order["status"], "status": to_status, "reason": reason}
        except Exception:
            connection.rollback()
            raise
        finally:
            cursor.close()
            connection.close()

    def list_order_status_history(self, external_id: str) -> Sequence[dict]:
        return self._fetch_all(
            """SELECT h.id, h.from_status, h.to_status, h.reason, h.created_at, u.full_name AS created_by
               FROM order_status_history h JOIN orders o ON o.id = h.order_id
               LEFT JOIN users u ON u.id = h.created_by
               WHERE o.external_id = %s ORDER BY h.created_at DESC""",
            (external_id,),
        )

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

    def list_stock_movements(self, sku: str | None = None, limit: int = 100) -> Sequence[dict]:
        safe_limit = max(1, min(limit, 500))
        params: tuple[Any, ...] = ()
        where = ""
        if sku:
            where = "WHERE p.sku = %s"
            params = (sku,)
        return self._fetch_all(
            f"""SELECT sm.id, sm.movement_type, sm.quantity_delta, sm.reserved_delta,
                       sm.resulting_quantity, sm.resulting_reserved_quantity,
                       sm.reference_type, sm.reference_id, sm.reason, sm.created_at,
                       p.sku, p.description AS product, w.code AS warehouse_code,
                       u.full_name AS created_by
                FROM stock_movements sm
                JOIN products p ON p.id = sm.product_id
                JOIN warehouses w ON w.id = sm.warehouse_id
                LEFT JOIN users u ON u.id = sm.created_by
                {where}
                ORDER BY sm.created_at DESC LIMIT {safe_limit}""",
            params,
        )

    def create_stock_movement(self, payload: dict) -> dict:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute(
                """SELECT si.id AS stock_id, si.warehouse_id, si.quantity, si.reserved_quantity,
                          si.minimum_quantity, p.id AS product_id, p.sku, p.description
                   FROM stock_items si JOIN products p ON p.id = si.product_id
                   JOIN warehouses w ON w.id = si.warehouse_id
                   WHERE p.sku = %s AND w.code = %s LIMIT 1 FOR UPDATE""",
                (payload["sku"], payload.get("warehouse_code", "MAD-01")),
            )
            stock = cursor.fetchone()
            if not stock:
                raise ValueError(f"SKU no encontrado en el almacén: {payload['sku']}")
            movement_type = payload["movement_type"]
            amount = float(payload["quantity"])
            if amount <= 0 and movement_type != "adjustment":
                raise ValueError("La cantidad debe ser mayor que cero")
            quantity_delta = amount if movement_type == "entry" else -amount if movement_type == "exit" else float(payload.get("adjustment_quantity", 0)) if movement_type == "adjustment" else 0
            reserved_delta = amount if movement_type == "reserve" else -amount if movement_type == "release" else 0
            current_quantity = float(stock["quantity"])
            current_reserved = float(stock["reserved_quantity"])
            resulting_quantity = current_quantity + quantity_delta
            resulting_reserved = current_reserved + reserved_delta
            if resulting_quantity < 0:
                raise ValueError("La salida supera el stock disponible")
            if resulting_reserved < 0 or resulting_reserved > resulting_quantity:
                raise ValueError("La reserva no puede superar el stock disponible")
            cursor.execute("UPDATE stock_items SET quantity = %s, reserved_quantity = %s WHERE id = %s", (resulting_quantity, resulting_reserved, stock["stock_id"]))
            cursor.execute(
                """INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_delta, reserved_delta, resulting_quantity, resulting_reserved_quantity, reference_type, reference_id, reason, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, (SELECT id FROM users WHERE email = 'laura.martin@smartwarehouse.local' LIMIT 1))""",
                (stock["warehouse_id"], stock["product_id"], movement_type, quantity_delta, reserved_delta, resulting_quantity, resulting_reserved, payload.get("reference_type"), payload.get("reference_id"), payload.get("reason")),
            )
            movement_id = cursor.lastrowid
            cursor.execute(
                "INSERT INTO audit_events (event_type, severity, aggregate_type, aggregate_id, actor_type, payload) VALUES ('stock.movement', 'info', 'product', %s, 'user', %s)",
                (stock["sku"], json.dumps({"movement_id": movement_id, "movement_type": movement_type, "quantity_delta": quantity_delta, "reserved_delta": reserved_delta, "resulting_quantity": resulting_quantity, "resulting_reserved_quantity": resulting_reserved}, ensure_ascii=False)),
            )
            connection.commit()
            return {"id": movement_id, "sku": stock["sku"], "product": stock["description"], "movement_type": movement_type, "quantity_delta": quantity_delta, "reserved_delta": reserved_delta, "resulting_quantity": resulting_quantity, "resulting_reserved_quantity": resulting_reserved, "status": "recorded"}
        except Exception:
            connection.rollback()
            raise
        finally:
            cursor.close()
            connection.close()

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

    def list_product_offers(self, sku: str) -> Sequence[dict]:
        return self._fetch_all(
            """SELECT p.sku, p.description AS product, s.code AS supplier_code,
                      s.legal_name AS supplier, sp.supplier_sku, sp.unit_cost,
                      sp.currency, sp.minimum_order_quantity, sp.lead_time_days,
                      sp.is_preferred
               FROM supplier_products sp
               JOIN products p ON p.id = sp.product_id
               JOIN suppliers s ON s.id = sp.supplier_id
               WHERE p.sku = %s AND s.status <> 'blocked'
               ORDER BY sp.is_preferred DESC, sp.unit_cost, s.legal_name""",
            (sku,),
        )

    def list_invoices(self) -> Sequence[dict]:
        return self._fetch_all(
            """
            SELECT i.invoice_number, s.legal_name AS supplier, i.invoice_date,
                   i.total, i.currency, i.status, d.extraction_status, d.confidence,
                   ir.status AS reconciliation_status, ir.confidence AS reconciliation_confidence,
                   ir.checks_json AS reconciliation_checks, o.external_id AS order_number,
                   gr.receipt_number, ae.status AS accounting_status,
                   ae.exported_at, ae.target_system
            FROM invoices i
            LEFT JOIN suppliers s ON s.id = i.supplier_id
            LEFT JOIN documents d ON d.id = i.document_id
            LEFT JOIN invoice_reconciliations ir ON ir.id = (
                SELECT latest.id FROM invoice_reconciliations latest
                WHERE latest.invoice_id = i.id ORDER BY latest.created_at DESC LIMIT 1
            )
            LEFT JOIN orders o ON o.id = ir.order_id
            LEFT JOIN goods_receipts gr ON gr.id = ir.receipt_id
            LEFT JOIN invoice_accounting_exports ae ON ae.invoice_id = i.id
            ORDER BY i.created_at DESC
            """
        )

    def accounting_export_rows(self) -> Sequence[dict]:
        return self._fetch_all(
            """
            SELECT i.invoice_number, i.invoice_date, s.code AS supplier_code,
                   s.legal_name AS supplier, s.tax_id AS supplier_tax_id,
                   i.currency, i.subtotal, i.tax_amount, i.total,
                   ae.status AS accounting_status, ae.target_system,
                   ir.status AS reconciliation_status, o.external_id AS order_number,
                   gr.receipt_number
            FROM invoices i
            JOIN suppliers s ON s.id = i.supplier_id
            JOIN invoice_accounting_exports ae ON ae.invoice_id = i.id
            LEFT JOIN invoice_reconciliations ir ON ir.invoice_id = i.id
            LEFT JOIN orders o ON o.id = ir.order_id
            LEFT JOIN goods_receipts gr ON gr.id = ir.receipt_id
            WHERE ae.status IN ('exportable', 'exported')
            ORDER BY i.invoice_date, i.invoice_number
            """
        )

    def list_procedures(self, external_id: str | None = None) -> Sequence[dict]:
        if external_id:
            return self._fetch_all(
                """
                SELECT rp.code, rp.name, rp.description, rp.active,
                       op.status,
                       op.checked_at, d.original_filename
                FROM orders o
                JOIN order_procedures op ON op.order_id = o.id
                JOIN required_procedures rp ON rp.id = op.procedure_id
                LEFT JOIN documents d ON d.id = op.document_id
                WHERE o.external_id = %s AND rp.active = TRUE
                ORDER BY rp.code
                """,
                (external_id,),
            )
        return self._fetch_all(
            """
            SELECT rp.code, rp.name, rp.description, rp.active,
                   COUNT(DISTINCT op.order_id) AS linked_orders,
                   SUM(CASE WHEN op.status = 'complete' THEN 1 ELSE 0 END) AS completed_orders,
                   COUNT(DISTINCT op.order_id) - SUM(CASE WHEN op.status = 'complete' THEN 1 ELSE 0 END) AS missing_orders
            FROM required_procedures rp
            CROSS JOIN orders o
            LEFT JOIN order_procedures op ON op.procedure_id = rp.id AND op.order_id = o.id
            WHERE rp.active = TRUE
            GROUP BY rp.id
            ORDER BY rp.code
            """
        )

    def _storage_path(self, category: str, filename: str) -> tuple[str, Path]:
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).name) or "document.pdf"
        relative = Path("local") / category / f"{uuid4().hex}_{safe_name}"
        root = Path(__file__).resolve().parents[4] / self.settings.local_storage_path
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        return relative.as_posix(), target

    def save_invoice_document(self, filename: str, mime_type: str, content: bytes, extracted: dict) -> dict:
        storage_key, target = self._storage_path("invoices", filename)
        target.write_bytes(content)
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            supplier = None
            if extracted.get("supplier_tax_id"):
                cursor.execute("SELECT id, legal_name FROM suppliers WHERE tax_id = %s LIMIT 1", (extracted["supplier_tax_id"],))
                supplier = cursor.fetchone()
            cursor.execute(
                """INSERT INTO documents (document_type, original_filename, storage_key, mime_type, extraction_status, confidence, extracted_json, uploaded_by)
                   VALUES ('invoice', %s, %s, %s, %s, %s, %s, (SELECT id FROM users WHERE email = 'laura.martin@smartwarehouse.local' LIMIT 1))""",
                (filename, storage_key, mime_type, extracted["extraction_status"], extracted.get("confidence"), json.dumps(extracted, ensure_ascii=False)),
            )
            document_id = cursor.lastrowid
            invoice_number = extracted.get("invoice_number") or f"PENDING-{uuid4().hex[:10].upper()}"
            cursor.execute(
                """INSERT INTO invoices (document_id, supplier_id, invoice_number, invoice_date, currency, subtotal, tax_amount, total, status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE document_id = VALUES(document_id), invoice_date = VALUES(invoice_date), subtotal = VALUES(subtotal), tax_amount = VALUES(tax_amount), total = VALUES(total), status = VALUES(status)""",
                (document_id, supplier["id"] if supplier else None, invoice_number, extracted.get("invoice_date"), extracted.get("currency", "EUR"), extracted.get("subtotal"), extracted.get("tax"), extracted.get("total"), "exportable" if extracted["extraction_status"] == "extracted" and supplier else "pending_review"),
            )
            severity = "info" if extracted["extraction_status"] == "extracted" and supplier else "warning"
            event_payload = {"filename": filename, "invoice_number": invoice_number, "confidence": extracted.get("confidence"), "storage_key": storage_key}
            cursor.execute(
                "INSERT INTO audit_events (event_type, severity, aggregate_type, aggregate_id, actor_type, payload) VALUES ('document.extracted', %s, 'invoice', %s, 'system', %s)",
                (severity, invoice_number, json.dumps(event_payload, ensure_ascii=False)),
            )
            event_id = cursor.lastrowid
            if severity == "warning":
                cursor.execute(
                    "INSERT INTO notifications (event_id, channel, status, title, body) VALUES (%s, 'in_app', 'pending', %s, %s)",
                    (event_id, "Factura requiere revisión", f"{filename}: faltan datos fiables o no se ha identificado el proveedor."),
                )
            connection.commit()
            reconciliation = self.reconcile_invoice(invoice_number)
            return {"invoice_number": invoice_number, "filename": filename, "status": "exportable" if severity == "info" else "pending_review", "confidence": extracted.get("confidence"), "storage_key": storage_key, "extraction_source": extracted.get("extraction_source"), "ocr_applied": extracted.get("ocr_attempted", False), "low_confidence_fields": extracted.get("low_confidence_fields", []), "review_reasons": extracted.get("review_reasons", []), "reconciliation": reconciliation}
        except Exception:
            connection.rollback()
            if target.exists():
                target.unlink()
            raise
        finally:
            cursor.close()
            connection.close()

    def reconcile_invoice(self, invoice_number: str) -> dict:
        """Run deterministic three-way matching: invoice, purchase order and receipt."""
        invoice_rows = self._fetch_all(
            """
            SELECT i.id AS invoice_id, i.invoice_number, i.supplier_id, s.legal_name AS supplier,
                   i.currency, i.subtotal, i.tax_amount, i.total, i.invoice_date,
                   d.extracted_json
            FROM invoices i
            LEFT JOIN suppliers s ON s.id = i.supplier_id
            LEFT JOIN documents d ON d.id = i.document_id
            WHERE i.invoice_number = %s
            LIMIT 1
            """,
            (invoice_number,),
        )
        if not invoice_rows:
            raise ValueError(f"Factura no encontrada: {invoice_number}")
        invoice = invoice_rows[0]
        extracted = invoice.get("extracted_json") or {}
        if isinstance(extracted, str):
            extracted = json.loads(extracted)

        candidates = self._fetch_all(
            """
            SELECT o.id AS order_id, o.external_id, o.supplier_id, s.legal_name AS supplier,
                   o.currency, o.subtotal, o.tax_amount, o.total, o.requested_at,
                   ol.product_id, p.sku, p.description, ol.requested_quantity, ol.unit_price, ol.line_total
            FROM orders o
            LEFT JOIN suppliers s ON s.id = o.supplier_id
            LEFT JOIN order_lines ol ON ol.order_id = o.id
            LEFT JOIN products p ON p.id = ol.product_id
            WHERE o.supplier_id = %s
            ORDER BY ABS(o.total - COALESCE(%s, 0)), o.requested_at DESC
            LIMIT 20
            """,
            (invoice["supplier_id"], invoice["total"]),
        ) if invoice.get("supplier_id") else []

        order = None
        if candidates:
            grouped: dict[int, dict] = {}
            for row in candidates:
                current = grouped.setdefault(row["order_id"], {**row, "lines": []})
                if row.get("product_id"):
                    current["lines"].append(row)
            order = min(grouped.values(), key=lambda item: abs(float(item.get("total") or 0) - float(invoice.get("total") or 0)))

        def money(value):
            return round(float(value), 2) if value is not None else None

        def check(status: str, expected, actual, detail: str) -> dict:
            return {"status": status, "expected": expected, "actual": actual, "detail": detail}

        if not order:
            checks = {
                "supplier": check("missing", invoice.get("supplier"), None, "No hay pedidos del proveedor identificado"),
                "lines": check("missing", None, None, "No se encontró un pedido candidato"),
                "quantities": check("missing", None, None, "No se encontró un pedido candidato"),
                "taxes": check("missing", None, money(invoice.get("tax_amount")), "No se encontró un pedido candidato"),
                "total": check("missing", None, money(invoice.get("total")), "No se encontró un pedido candidato"),
                "receipt": check("missing", None, None, "No existe una recepción vinculada"),
            }
            return self._persist_reconciliation(invoice, None, None, checks)

        supplier_match = invoice.get("supplier_id") == order.get("supplier_id")
        total_match = money(invoice.get("total")) is not None and abs(money(invoice.get("total")) - money(order.get("total"))) <= 0.01
        tax_available = invoice.get("tax_amount") is not None and order.get("tax_amount") is not None
        tax_match = tax_available and abs(money(invoice.get("tax_amount")) - money(order.get("tax_amount"))) <= 0.01

        invoice_lines = extracted.get("lines") if isinstance(extracted, dict) else None
        invoice_lines = invoice_lines if isinstance(invoice_lines, list) else []
        order_lines = order["lines"]
        line_comparison = []
        if invoice_lines:
            by_sku = {str(line.get("sku", "")).upper(): line for line in invoice_lines}
            for line in order_lines:
                invoice_line = by_sku.get(str(line.get("sku", "")).upper())
                expected_qty = money(line.get("requested_quantity"))
                actual_qty = money(invoice_line.get("quantity")) if invoice_line else None
                line_comparison.append({"sku": line.get("sku"), "order_quantity": expected_qty, "invoice_quantity": actual_qty, "match": actual_qty is not None and abs(expected_qty - actual_qty) <= 0.001})
            lines_match = bool(line_comparison) and all(item["match"] for item in line_comparison)
            lines_status = "match" if lines_match else "mismatch"
            lines_detail = "Líneas y cantidades comparadas contra el pedido"
        else:
            lines_match = False
            lines_status = "missing"
            lines_detail = "La factura no contiene líneas estructuradas para comparar"

        receipt_rows = self._fetch_all(
            """
            SELECT gr.id AS receipt_id, gr.receipt_number, gr.status,
                   grl.product_id, grl.expected_quantity, grl.received_quantity, p.sku
            FROM goods_receipts gr
            LEFT JOIN goods_receipt_lines grl ON grl.receipt_id = gr.id
            LEFT JOIN products p ON p.id = grl.product_id
            WHERE gr.order_id = %s
            ORDER BY gr.created_at DESC
            """,
            (order["order_id"],),
        )
        receipt = receipt_rows[0] if receipt_rows else None
        receipt_complete = bool(receipt) and receipt["status"] in {"received", "complete", "available"} and all(float(row.get("received_quantity") or 0) >= float(row.get("expected_quantity") or 0) for row in receipt_rows if row.get("product_id"))
        receipt_status = "complete" if receipt_complete else "partial" if receipt else "missing"

        checks = {
            "supplier": check("match" if supplier_match else "mismatch", invoice.get("supplier"), order.get("supplier"), "Proveedor de factura y pedido"),
            "lines": check(lines_status, len(order_lines), len(invoice_lines), lines_detail),
            "quantities": check("match" if lines_match else "missing" if not invoice_lines else "mismatch", [money(line.get("requested_quantity")) for line in order_lines], [item.get("invoice_quantity") for item in line_comparison], "Cantidades por línea"),
            "taxes": check("match" if tax_match else "missing" if not tax_available else "mismatch", money(order.get("tax_amount")), money(invoice.get("tax_amount")), "Impuestos del pedido y la factura"),
            "total": check("match" if total_match else "mismatch", money(order.get("total")), money(invoice.get("total")), "Total de pedido y factura"),
            "receipt": check(receipt_status, receipt["receipt_number"] if receipt else None, [row.get("received_quantity") for row in receipt_rows], "Recepción de almacén vinculada al pedido"),
        }
        return self._persist_reconciliation(invoice, order, receipt, checks)

    def _persist_reconciliation(self, invoice: dict, order: dict | None, receipt: dict | None, checks: dict) -> dict:
        statuses = [item["status"] for item in checks.values()]
        matched = all(status == "match" or (key == "receipt" and status == "complete") for key, status in ((key, value["status"]) for key, value in checks.items()))
        status = "matched" if matched else "pending_review"
        confidence = 1.0 if matched else round(sum(status in {"match", "complete"} for status in statuses) / max(len(statuses), 1), 4)
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute(
                """INSERT INTO invoice_reconciliations (invoice_id, order_id, receipt_id, status, confidence, checks_json)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE order_id = VALUES(order_id), receipt_id = VALUES(receipt_id), status = VALUES(status), confidence = VALUES(confidence), checks_json = VALUES(checks_json), updated_at = CURRENT_TIMESTAMP""",
                (invoice["invoice_id"], order["order_id"] if order else None, receipt["receipt_id"] if receipt else None, status, confidence, json.dumps(checks, ensure_ascii=False)),
            )
            event_type = "invoice.reconciled" if status == "matched" else "invoice.reconciliation_review"
            severity = "info" if status == "matched" else "warning"
            cursor.execute(
                "INSERT INTO audit_events (event_type, severity, aggregate_type, aggregate_id, actor_type, payload) VALUES (%s, %s, 'invoice', %s, 'system', %s)",
                (event_type, severity, invoice["invoice_number"], json.dumps({"status": status, "order": order.get("external_id") if order else None, "checks": checks}, ensure_ascii=False)),
            )
            if status != "matched":
                event_id = cursor.lastrowid
                cursor.execute(
                    "INSERT INTO notifications (event_id, channel, status, title, body) VALUES (%s, 'in_app', 'pending', %s, %s)",
                    (event_id, "Conciliación requiere revisión", f"{invoice['invoice_number']}: existen diferencias o datos pendientes entre factura, pedido y recepción."),
                )
            connection.commit()
            return {"invoice_number": invoice["invoice_number"], "status": status, "confidence": confidence, "order": order.get("external_id") if order else None, "receipt": receipt.get("receipt_number") if receipt else None, "checks": checks}
        except Exception:
            connection.rollback()
            raise
        finally:
            cursor.close()
            connection.close()

    def mark_invoice_exported(self, invoice_number: str, export_format: str, target_system: str) -> dict:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute(
                """SELECT i.id, i.invoice_number, ae.status
                   FROM invoices i JOIN invoice_accounting_exports ae ON ae.invoice_id = i.id
                   WHERE i.invoice_number = %s LIMIT 1""",
                (invoice_number,),
            )
            invoice = cursor.fetchone()
            if not invoice:
                raise ValueError(f"Factura no disponible para exportación: {invoice_number}")
            if invoice["status"] == "pending":
                raise ValueError("La factura todavía no es exportable")
            cursor.execute(
                """UPDATE invoice_accounting_exports
                   SET status = 'exported', export_format = %s, target_system = %s,
                       external_reference = %s, exported_at = NOW(), payload_json = JSON_OBJECT('adapter', 'rest', 'target_system', %s)
                   WHERE invoice_id = %s""",
                (export_format, target_system, f"{target_system}:{invoice_number}", target_system, invoice["id"]),
            )
            cursor.execute(
                "INSERT INTO audit_events (event_type, severity, aggregate_type, aggregate_id, actor_type, payload) VALUES ('accounting.exported', 'info', 'invoice', %s, 'system', %s)",
                (invoice_number, json.dumps({"format": export_format, "target_system": target_system}, ensure_ascii=False)),
            )
            connection.commit()
            return {"invoice_number": invoice_number, "status": "exported", "format": export_format, "target_system": target_system, "external_reference": f"{target_system}:{invoice_number}"}
        except Exception:
            connection.rollback()
            raise
        finally:
            cursor.close()
            connection.close()

    def save_procedure_document(self, external_id: str, procedure_code: str, filename: str, mime_type: str, content: bytes) -> dict:
        storage_key, target = self._storage_path("procedures", filename)
        target.write_bytes(content)
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute("SELECT id, status FROM orders WHERE external_id = %s LIMIT 1", (external_id,))
            order = cursor.fetchone()
            cursor.execute("SELECT id, name FROM required_procedures WHERE code = %s AND active = TRUE LIMIT 1", (procedure_code,))
            procedure = cursor.fetchone()
            if not order or not procedure:
                raise ValueError("Pedido o procedimiento obligatorio no encontrado")
            if order.get("status") not in {"pending", "validated"}:
                raise ValueError("La documentación obligatoria solo puede completarse antes de aprobar el pedido")
            cursor.execute("SELECT 1 FROM order_procedures WHERE order_id = %s AND procedure_id = %s LIMIT 1", (order["id"], procedure["id"]))
            if not cursor.fetchone():
                raise ValueError("Este procedimiento no fue seleccionado como requisito del pedido")
            cursor.execute(
                """INSERT INTO documents (document_type, original_filename, storage_key, mime_type, extraction_status, confidence, uploaded_by)
                   VALUES ('procedure', %s, %s, %s, 'not_applicable', 1.0000, (SELECT id FROM users WHERE email = 'laura.martin@smartwarehouse.local' LIMIT 1))""",
                (filename, storage_key, mime_type),
            )
            document_id = cursor.lastrowid
            cursor.execute(
                """INSERT INTO order_procedures (order_id, procedure_id, document_id, status, checked_at)
                   VALUES (%s, %s, %s, 'complete', NOW())
                   ON DUPLICATE KEY UPDATE document_id = VALUES(document_id), status = 'complete', checked_at = NOW()""",
                (order["id"], procedure["id"], document_id),
            )
            payload = json.dumps({"filename": filename, "storage_key": storage_key, "procedure_code": procedure_code}, ensure_ascii=False)
            cursor.execute(
                "INSERT INTO audit_events (event_type, severity, aggregate_type, aggregate_id, actor_type, payload) VALUES ('procedure.completed', 'info', 'order', %s, 'user', %s)",
                (external_id, payload),
            )
            connection.commit()
            return {"external_id": external_id, "procedure_code": procedure_code, "procedure_name": procedure["name"], "status": "complete", "filename": filename}
        except Exception:
            connection.rollback()
            if target.exists():
                target.unlink()
            raise
        finally:
            cursor.close()
            connection.close()

    def list_receipts(self) -> Sequence[dict]:
        return self._fetch_all(
            """
            SELECT gr.receipt_number, gr.dock_code, gr.status, gr.expected_at,
                   o.external_id, s.legal_name AS supplier, p.description AS product,
                   COALESCE(grl.expected_quantity, ol.requested_quantity) AS expected_quantity,
                   COALESCE(grl.received_quantity, 0) AS received_quantity,
                   COALESCE(grl.damaged_quantity, 0) AS damaged_quantity,
                   grl.damage_reason,
                   CASE WHEN grl.id IS NULL THEN 'pending' WHEN grl.damaged_quantity > 0 OR grl.received_quantity <> grl.expected_quantity THEN 'discrepancy' ELSE 'complete' END AS receipt_result
            FROM goods_receipts gr
            LEFT JOIN orders o ON o.id = gr.order_id
            LEFT JOIN suppliers s ON s.id = o.supplier_id
            LEFT JOIN order_lines ol ON ol.order_id = o.id
            LEFT JOIN products p ON p.id = ol.product_id
            LEFT JOIN goods_receipt_lines grl ON grl.receipt_id = gr.id AND grl.product_id = ol.product_id
            ORDER BY gr.expected_at
            """
        )

    def create_receipt(self, payload: dict) -> dict:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute(
                """SELECT o.id, o.external_id, o.warehouse_id, s.legal_name AS supplier
                   FROM orders o LEFT JOIN suppliers s ON s.id = o.supplier_id
                   WHERE o.external_id = %s LIMIT 1""",
                (payload["order_external_id"],),
            )
            order = cursor.fetchone()
            if not order:
                raise ValueError(f"Pedido no encontrado: {payload['order_external_id']}")
            receipt_number = payload.get("receipt_number") or f"REC-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            cursor.execute(
                """INSERT INTO goods_receipts (receipt_number, order_id, warehouse_id, dock_code, status, expected_at, received_at)
                   VALUES (%s, %s, %s, %s, %s, NOW(), COALESCE(%s, NOW()))""",
                (receipt_number, order["id"], order["warehouse_id"], payload.get("dock_code"), "received", payload.get("received_at")),
            )
            receipt_id = cursor.lastrowid
            results = []
            has_discrepancy = False
            for line in payload["lines"]:
                cursor.execute(
                    """SELECT p.id AS product_id, p.sku, ol.requested_quantity
                       FROM products p JOIN order_lines ol ON ol.product_id = p.id
                       WHERE p.sku = %s AND ol.order_id = %s LIMIT 1""",
                    (line["sku"], order["id"]),
                )
                expected = cursor.fetchone()
                if not expected:
                    raise ValueError(f"SKU {line['sku']} no pertenece al pedido {order['external_id']}")
                received = float(line.get("received_quantity", 0))
                damaged = float(line.get("damaged_quantity", 0))
                requested = float(expected["requested_quantity"])
                if received < 0 or damaged < 0 or received + damaged > requested:
                    raise ValueError(f"Cantidad inválida para {line['sku']}: recibida + dañada supera la solicitada")
                discrepancy = abs((received + damaged) - requested) > 0.001 or damaged > 0
                has_discrepancy = has_discrepancy or discrepancy
                cursor.execute(
                    """INSERT INTO goods_receipt_lines (receipt_id, product_id, expected_quantity, received_quantity, damaged_quantity, damage_reason)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (receipt_id, expected["product_id"], requested, received, damaged, line.get("damage_reason")),
                )
                results.append({"sku": line["sku"], "requested_quantity": requested, "received_quantity": received, "damaged_quantity": damaged, "discrepancy": discrepancy, "damage_reason": line.get("damage_reason")})
            status = "discrepancy" if has_discrepancy else "received"
            cursor.execute("UPDATE goods_receipts SET status = %s WHERE id = %s", (status, receipt_id))
            severity = "warning" if has_discrepancy else "info"
            payload_json = {"receipt_number": receipt_number, "order": order["external_id"], "lines": results}
            cursor.execute(
                "INSERT INTO audit_events (event_type, severity, aggregate_type, aggregate_id, actor_type, payload) VALUES ('receipt.registered', %s, 'receipt', %s, 'system', %s)",
                (severity, receipt_number, json.dumps(payload_json, ensure_ascii=False)),
            )
            if has_discrepancy:
                cursor.execute(
                    "INSERT INTO notifications (event_id, channel, status, title, body) VALUES (%s, 'in_app', 'pending', %s, %s)",
                    (cursor.lastrowid, "Diferencia en recepción", f"{receipt_number}: existen cantidades dañadas o diferencias frente al pedido {order['external_id']}.")
                )
            connection.commit()
            return {"receipt_number": receipt_number, "order": order["external_id"], "supplier": order["supplier"], "status": status, "has_discrepancy": has_discrepancy, "lines": results}
        except Exception:
            connection.rollback()
            raise
        finally:
            cursor.close()
            connection.close()

    def list_events(self, limit: int = 50, severity: str | None = None, event_type: str | None = None, aggregate_type: str | None = None) -> Sequence[dict]:
        safe_limit = max(1, min(limit, 200))
        clauses = []
        params: list[Any] = []
        for column, value in (("severity", severity), ("event_type", event_type), ("aggregate_type", aggregate_type)):
            if value:
                clauses.append(f"{column} = %s")
                params.append(value)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return self._fetch_all(
            f"""SELECT id, event_type, severity, aggregate_type, aggregate_id,
                       actor_type, payload, created_at
                FROM audit_events {where} ORDER BY created_at DESC LIMIT {safe_limit}""",
            tuple(params),
        )

    def get_event(self, event_id: int) -> dict | None:
        rows = self._fetch_all(
            """SELECT id, event_type, severity, aggregate_type, aggregate_id,
                      actor_type, actor_id, payload, created_at
               FROM audit_events WHERE id = %s LIMIT 1""",
            (event_id,),
        )
        return rows[0] if rows else None

    def list_alerts(self, limit: int = 50, severity: str | None = None, event_type: str | None = None, status: str = "unread") -> Sequence[dict]:
        safe_limit = max(1, min(limit, 200))
        clauses = []
        params: list[Any] = []
        if status != "all":
            clauses.append("n.status = %s")
            params.append("pending" if status == "unread" else status)
        if severity:
            clauses.append("e.severity = %s")
            params.append(severity)
        if event_type:
            clauses.append("e.event_type = %s")
            params.append(event_type)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return self._fetch_all(
            f"""SELECT n.id, n.title, n.body, n.status, n.channel, n.read_at, n.created_at,
                       e.event_type, e.severity, e.aggregate_type, e.aggregate_id
                FROM notifications n
                LEFT JOIN audit_events e ON e.id = n.event_id
                {where}
                ORDER BY n.created_at DESC LIMIT {safe_limit}""",
            tuple(params),
        )

    def mark_alert_read(self, alert_id: int) -> dict:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute("UPDATE notifications SET status = 'read', read_at = NOW() WHERE id = %s", (alert_id,))
            if cursor.rowcount == 0:
                raise ValueError(f"Alerta no encontrada: {alert_id}")
            connection.commit()
            return {"id": alert_id, "status": "read"}
        finally:
            cursor.close()
            connection.close()

    def mark_all_alerts_read(self) -> int:
        connection = self._connect()
        cursor = connection.cursor()
        try:
            cursor.execute("UPDATE notifications SET status = 'read', read_at = NOW() WHERE status IN ('pending', 'unread')")
            total = cursor.rowcount
            connection.commit()
            return total
        finally:
            cursor.close()
            connection.close()

    def list_alert_rules(self) -> Sequence[dict]:
        return self._fetch_all("SELECT id, code, name, description, event_type, severity, enabled, recipients_json, channels_json, created_at, updated_at FROM alert_rules ORDER BY name")

    def create_alert_rule(self, payload: dict) -> dict:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute(
                """INSERT INTO alert_rules (code, name, description, event_type, severity, enabled, recipients_json, channels_json)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (payload["code"], payload["name"], payload.get("description"), payload["event_type"], payload["severity"], payload.get("enabled", True), json.dumps(payload.get("recipients", [])), json.dumps(payload.get("channels", ["in_app"]))),
            )
            connection.commit()
            return {"id": cursor.lastrowid, **payload}
        except mysql.connector.Error as error:
            connection.rollback()
            raise ValueError(f"No se pudo crear la regla: {error.msg}") from error
        finally:
            cursor.close()
            connection.close()

    def update_alert_rule(self, rule_id: int, payload: dict) -> dict:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            fields = {"name": payload.get("name"), "description": payload.get("description"), "event_type": payload.get("event_type"), "severity": payload.get("severity"), "enabled": payload.get("enabled"), "recipients_json": json.dumps(payload.get("recipients", [])), "channels_json": json.dumps(payload.get("channels", ["in_app"]))}
            cursor.execute("UPDATE alert_rules SET name=%s, description=%s, event_type=%s, severity=%s, enabled=%s, recipients_json=%s, channels_json=%s WHERE id=%s", (*fields.values(), rule_id))
            if cursor.rowcount == 0:
                raise ValueError(f"Regla no encontrada: {rule_id}")
            connection.commit()
            return {"id": rule_id, **payload}
        finally:
            cursor.close()
            connection.close()

    def list_decisions(self, external_id: str) -> Sequence[dict]:
        return self._fetch_all(
            """
            SELECT vd.id, o.external_id, vd.decision_status, vd.risk,
                   vd.confidence, vd.reasons, vd.created_at
            FROM validation_decisions vd
            JOIN orders o ON o.id = vd.order_id
            WHERE o.external_id = %s
            ORDER BY vd.created_at DESC
            """,
            (external_id,),
        )

    def save_validation(self, external_id: str, decision: dict) -> None:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute("SELECT id, status, requester_id FROM orders WHERE external_id = %s", (external_id,))
            order = cursor.fetchone()
            if not order:
                return
            if order.get("status") not in {"pending", "human_review"}:
                raise ValueError("La validación solo puede ejecutarse sobre un pedido pendiente")
            cursor.execute(
                """SELECT COUNT(*) AS total_required,
                          SUM(CASE WHEN op.status = 'complete' THEN 1 ELSE 0 END) AS completed_required
                   FROM order_procedures op
                   JOIN required_procedures rp ON rp.id = op.procedure_id
                   WHERE op.order_id = %s AND rp.active = TRUE""",
                (order["id"],),
            )
            documents = cursor.fetchone() or {}
            total_required = int(documents.get("total_required") or 0)
            completed_required = int(documents.get("completed_required") or 0)
            if completed_required < total_required:
                raise ValueError(f"No se puede validar el pedido: faltan {total_required - completed_required} documentos obligatorios")
            cursor.execute(
                "INSERT INTO validation_decisions (order_id, decision_status, risk, confidence, reasons) VALUES (%s, %s, %s, %s, %s)",
                (order["id"], decision["status"], decision["risk"], 1.0, json.dumps(decision["reasons"], ensure_ascii=False))
            )
            workflow_status = "validated" if decision["status"] == "human_review" else decision["status"]
            cursor.execute(
                "UPDATE orders SET status = %s, risk = %s, approved_at = CASE WHEN %s = 'approved' THEN NOW() ELSE NULL END WHERE id = %s",
                (workflow_status, decision["risk"], workflow_status, order["id"]),
            )
            cursor.execute("INSERT INTO order_status_history (order_id, from_status, to_status, reason) VALUES (%s, %s, %s, %s)", (order["id"], order.get("status"), workflow_status, "Validación automática"))
            severity = "info" if decision["risk"] == "green" else "critical" if decision["risk"] == "red" else "warning"
            payload = json.dumps({"decision_status": decision["status"], "risk": decision["risk"], "reasons": decision["reasons"]}, ensure_ascii=False)
            cursor.execute(
                "INSERT INTO audit_events (event_type, severity, aggregate_type, aggregate_id, actor_type, actor_id, payload) VALUES ('ai.validation', %s, 'order', %s, 'system', NULL, %s)",
                (severity, external_id, payload),
            )
            event_id = cursor.lastrowid
            if decision["risk"] != "green":
                title = "Pedido bloqueado" if decision["risk"] == "red" else "Pedido requiere revisión"
                cursor.execute(
                    "INSERT INTO notifications (user_id, event_id, channel, status, title, body) VALUES (%s, %s, 'in_app', 'pending', %s, %s)",
                    (order["requester_id"], event_id, title, f"{external_id}: {'; '.join(decision['reasons'])}"),
                )
            connection.commit()
        finally:
            cursor.close()
            connection.close()

    def record_ai_event(self, event_type: str, severity: str, aggregate_type: str, aggregate_id: str, payload: dict, notify: bool = False, title: str | None = None, body: str | None = None) -> int:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute(
                """INSERT INTO audit_events (event_type, severity, aggregate_type, aggregate_id, actor_type, payload)
                   VALUES (%s, %s, %s, %s, 'ai', %s)""",
                (event_type, severity, aggregate_type, aggregate_id, json.dumps(payload, ensure_ascii=False, default=str)),
            )
            event_id = cursor.lastrowid
            if notify:
                cursor.execute(
                    """INSERT INTO notifications (event_id, channel, status, title, body)
                       VALUES (%s, 'in_app', 'pending', %s, %s)""",
                    (event_id, title or "Aviso de inteligencia artificial", body or "Se ha generado una alerta de IA."),
                )
            connection.commit()
            return int(event_id)
        except Exception:
            connection.rollback()
            raise
        finally:
            cursor.close()
            connection.close()

    def list_integrations(self) -> Sequence[dict]:
        rows = self._fetch_all(
            """SELECT id, code, name, kind, protocol, status, endpoint,
                      configuration_json, secret_reference, enabled, updated_at
               FROM integration_connections ORDER BY name"""
        )
        for row in rows:
            value = row.get("configuration_json")
            if isinstance(value, str):
                try:
                    row["configuration"] = json.loads(value)
                except json.JSONDecodeError:
                    row["configuration"] = {}
            else:
                row["configuration"] = value or {}
            row.pop("configuration_json", None)
        return rows

    def record_integration_sync(self, code: str, direction: str, result: dict) -> dict:
        connection = self._connect()
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute("SELECT id FROM integration_connections WHERE code = %s LIMIT 1", (code,))
            integration = cursor.fetchone()
            if not integration:
                raise ValueError(f"Integración no encontrada: {code}")
            cursor.execute(
                """INSERT INTO integration_sync_runs
                   (integration_id, direction, status, records_count, response_json, finished_at)
                   VALUES (%s, %s, %s, %s, %s, NOW())""",
                (integration["id"], direction, result.get("status", "unknown"), int(result.get("records", 0)), json.dumps(result, ensure_ascii=False)),
            )
            event_payload = json.dumps({"integration": code, "direction": direction, "result": result}, ensure_ascii=False)
            cursor.execute(
                """INSERT INTO audit_events
                   (event_type, severity, aggregate_type, aggregate_id, actor_type, payload)
                   VALUES ('integration.sync', 'info', 'integration', %s, 'system', %s)""",
                (code, event_payload),
            )
            connection.commit()
            return {"integration": code, "direction": direction, **result}
        except Exception:
            connection.rollback()
            raise
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

            cursor.execute(
                """SELECT supplier_sku, unit_cost, currency FROM supplier_products
                   WHERE supplier_id = %s AND product_id = %s LIMIT 1""",
                (supplier["id"], product["id"]),
            )
            offer = cursor.fetchone()
            if not offer:
                raise ValueError("El producto no tiene una oferta configurada para el proveedor seleccionado")

            quantity = float(payload["quantity"])
            unit_price = float(offer["unit_cost"])
            total = round(quantity * unit_price, 2)
            cursor.execute(
                """INSERT INTO orders (external_id, title, order_type, status, risk, requester_id, supplier_id, warehouse_id, subtotal, tax_amount, total, requested_at)
                   VALUES (%s, %s, 'purchase_request', 'pending', 'yellow', %s, %s, %s, %s, %s, %s, NOW())
                   ON DUPLICATE KEY UPDATE title = VALUES(title), total = VALUES(total), updated_at = CURRENT_TIMESTAMP""",
                (external_id, payload.get("title"), requester["id"], supplier["id"], warehouse["id"], round(total / 1.21, 2), round(total - total / 1.21, 2), total),
            )
            cursor.execute("SELECT id FROM orders WHERE external_id = %s", (external_id,))
            order = cursor.fetchone()
            cursor.execute(
                """INSERT INTO order_lines (order_id, product_id, supplier_sku, requested_quantity, unit_price, line_total)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE supplier_sku = VALUES(supplier_sku), requested_quantity = VALUES(requested_quantity), unit_price = VALUES(unit_price), line_total = VALUES(line_total)""",
                (order["id"], product["id"], offer["supplier_sku"], quantity, unit_price, total),
            )
            requested_procedures = list(dict.fromkeys(payload.get("required_procedures") or []))
            if not requested_procedures:
                selected_procedures = []
            else:
                placeholders = ",".join(["%s"] * len(requested_procedures))
                cursor.execute(f"SELECT id, code FROM required_procedures WHERE active = TRUE AND code IN ({placeholders})", tuple(requested_procedures))
                selected_procedures = cursor.fetchall()
            selected_codes = {item["code"] for item in selected_procedures}
            if selected_codes != set(requested_procedures):
                raise ValueError("Uno de los procedimientos seleccionados no existe o no está activo")
            cursor.executemany(
                "INSERT IGNORE INTO order_procedures (order_id, procedure_id, status) VALUES (%s, %s, 'missing')",
                [(order["id"], item["id"]) for item in selected_procedures],
            )
            cursor.execute(
                """INSERT INTO order_status_history (order_id, from_status, to_status, reason)
                   SELECT %s, NULL, 'pending', 'Pedido creado'
                   WHERE NOT EXISTS (SELECT 1 FROM order_status_history WHERE order_id = %s)""",
                (order["id"], order["id"]),
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

    def preview_import_orders(self, rows: list[dict]) -> dict:
        external_ids = [row.get("external_order_id") for row in rows if row.get("external_order_id")]
        existing = set()
        if external_ids:
            placeholders = ",".join(["%s"] * len(external_ids))
            existing_rows = self._fetch_all(f"SELECT external_id FROM orders WHERE external_id IN ({placeholders})", tuple(external_ids))
            existing = {row["external_id"] for row in existing_rows}
        seen = set()
        errors = []
        valid_rows = []
        for row in rows:
            row_number = row.get("_row", "?")
            external_id = row.get("external_order_id")
            if external_id and external_id in existing:
                errors.append({"row": row_number, "field": "external_order_id", "message": f"El pedido {external_id} ya existe en MySQL"})
            elif external_id and external_id in seen:
                errors.append({"row": row_number, "field": "external_order_id", "message": f"El pedido {external_id} está duplicado dentro del archivo"})
            else:
                if external_id:
                    seen.add(external_id)
                valid_rows.append(row)
        return {"rows": rows, "valid_rows": valid_rows, "errors": errors, "error_count": len(errors), "preview_count": len(rows), "valid_count": len(valid_rows)}
