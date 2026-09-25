USE smart_warehouse;

DELIMITER $$
DROP PROCEDURE IF EXISTS seed_abundant_mock_data$$
CREATE PROCEDURE seed_abundant_mock_data()
BEGIN
  DECLARE i INT DEFAULT 1;
  DECLARE product_sku VARCHAR(64);
  DECLARE order_ref VARCHAR(64);
  DECLARE invoice_ref VARCHAR(96);
  DECLARE event_ref VARCHAR(64);
  DECLARE receipt_ref VARCHAR(64);
  DECLARE order_status VARCHAR(32);
  DECLARE order_risk VARCHAR(16);
  DECLARE order_total DECIMAL(14,2);

  WHILE i <= 48 DO
    SET product_sku = CONCAT('MOCK-SKU-', LPAD(i, 3, '0'));
    INSERT INTO products (sku, description, category, brand, unit_of_measure, size_m3)
    VALUES (
      product_sku,
      CONCAT(CASE WHEN MOD(i, 2) = 0 THEN 'Material eléctrico profesional ' ELSE 'Componente de fontanería profesional ' END, LPAD(i, 3, '0')),
      CASE WHEN MOD(i, 2) = 0 THEN 'Electricidad' ELSE 'Fontanería' END,
      CASE WHEN MOD(i, 3) = 0 THEN 'Genérico homologado' WHEN MOD(i, 3) = 1 THEN 'Industrial Pro' ELSE 'SupplyMax' END,
      CASE WHEN MOD(i, 5) = 0 THEN 'meter' ELSE 'unit' END,
      ROUND(0.002 + (MOD(i, 9) * 0.004), 6)
    ) ON DUPLICATE KEY UPDATE description = VALUES(description), category = VALUES(category);

    INSERT INTO stock_items (warehouse_id, location_id, product_id, quantity, reserved_quantity, minimum_quantity, reorder_quantity)
    SELECT w.id, l.id, p.id,
           30 + MOD(i * 73, 1100), MOD(i * 7, 36), 40 + MOD(i * 11, 180), 100 + MOD(i * 17, 500)
    FROM warehouses w JOIN storage_locations l ON l.warehouse_id = w.id AND l.code = CASE WHEN MOD(i, 3) = 0 THEN 'C-02-01' WHEN MOD(i, 2) = 0 THEN 'B-04-02' ELSE 'A-01-04' END
    JOIN products p ON p.sku = product_sku
    WHERE w.code = 'MAD-01'
    ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), reserved_quantity = VALUES(reserved_quantity), minimum_quantity = VALUES(minimum_quantity);
    SET i = i + 1;
  END WHILE;

  SET i = 1;
  WHILE i <= 60 DO
    SET order_ref = CONCAT('PED-2025-MOCK-', LPAD(i, 4, '0'));
    SET order_status = CASE WHEN MOD(i, 3) = 0 THEN 'approved' WHEN MOD(i, 11) = 0 THEN 'blocked' ELSE 'pending' END;
    SET order_risk = CASE WHEN MOD(i, 10) = 0 THEN 'red' WHEN MOD(i, 3) = 0 THEN 'green' ELSE 'yellow' END;
    SET order_total = ROUND(145 + MOD(i * 917, 12800) + (MOD(i, 4) * 0.50), 2);
    INSERT INTO orders (external_id, order_type, status, risk, requester_id, supplier_id, warehouse_id, subtotal, tax_amount, total, requested_at)
    SELECT order_ref, 'purchase_request', order_status, order_risk,
           (SELECT id FROM users WHERE email = CASE MOD(i - 1, 5) WHEN 0 THEN 'laura.martin@smartwarehouse.local' WHEN 1 THEN 'javier.soler@smartwarehouse.local' WHEN 2 THEN 'marta.gil@smartwarehouse.local' WHEN 3 THEN 'david.cano@smartwarehouse.local' ELSE 'ana.ruiz@smartwarehouse.local' END),
           (SELECT id FROM suppliers WHERE code = CASE MOD(i - 1, 4) WHEN 0 THEN 'ROCA' WHEN 1 THEN 'SALTOKI' WHEN 2 THEN 'GCABLE' ELSE 'SONEPAR' END),
           w.id, ROUND(order_total / 1.21, 2), ROUND(order_total - (order_total / 1.21), 2), order_total,
           DATE_SUB('2025-09-25 12:00:00', INTERVAL i * 3 HOUR)
    FROM warehouses w WHERE w.code = 'MAD-01'
    ON DUPLICATE KEY UPDATE status = VALUES(status), risk = VALUES(risk), total = VALUES(total);

    INSERT INTO order_lines (order_id, product_id, requested_quantity, unit_price, line_total)
    SELECT o.id, p.id, 5 + MOD(i * 13, 280), ROUND(order_total / (5 + MOD(i * 13, 280)), 4), order_total
    FROM orders o JOIN products p ON p.sku = CONCAT('MOCK-SKU-', LPAD(MOD(i - 1, 48) + 1, 3, '0'))
    WHERE o.external_id = order_ref
    ON DUPLICATE KEY UPDATE requested_quantity = VALUES(requested_quantity), unit_price = VALUES(unit_price), line_total = VALUES(line_total);

    INSERT INTO validation_decisions (order_id, decision_status, risk, confidence, reasons)
    SELECT o.id,
           CASE WHEN order_risk = 'green' THEN 'approved' WHEN order_risk = 'red' THEN 'blocked' ELSE 'human_review' END,
           order_risk, 0.9900,
           JSON_ARRAY(CASE WHEN order_risk = 'red' THEN 'Volumen atípico frente al histórico' WHEN order_risk = 'yellow' THEN 'Requiere comprobación de procedimiento' ELSE 'Stock y demanda compatibles' END)
    FROM orders o WHERE o.external_id = order_ref
      AND NOT EXISTS (SELECT 1 FROM validation_decisions vd WHERE vd.order_id = o.id);
    SET i = i + 1;
  END WHILE;

  SET i = 1;
  WHILE i <= 24 DO
    SET invoice_ref = CONCAT('FAC-2025-MOCK-', LPAD(i, 4, '0'));
    INSERT INTO documents (document_type, original_filename, storage_key, mime_type, extraction_status, confidence)
    VALUES ('invoice', CONCAT(invoice_ref, '.pdf'), CONCAT('local/invoices/', invoice_ref, '.pdf'), 'application/pdf', CASE WHEN MOD(i, 7) = 0 THEN 'needs_review' ELSE 'extracted' END, ROUND(0.9100 + (MOD(i, 9) * 0.009), 4));
    INSERT INTO invoices (document_id, supplier_id, invoice_number, invoice_date, total, status)
    SELECT LAST_INSERT_ID(), s.id, invoice_ref, DATE_SUB('2025-09-25', INTERVAL i DAY), ROUND(390 + MOD(i * 823, 15000), 2), CASE WHEN MOD(i, 7) = 0 THEN 'pending_review' ELSE 'exportable' END
    FROM suppliers s WHERE s.code = CASE MOD(i - 1, 4) WHEN 0 THEN 'ROCA' WHEN 1 THEN 'SALTOKI' WHEN 2 THEN 'GCABLE' ELSE 'SONEPAR' END
    ON DUPLICATE KEY UPDATE total = VALUES(total), status = VALUES(status);
    SET i = i + 1;
  END WHILE;

  SET i = 1;
  WHILE i <= 100 DO
    SET event_ref = CONCAT('MOCK-EVENT-', LPAD(i, 4, '0'));
    INSERT INTO audit_events (event_type, severity, aggregate_type, aggregate_id, actor_type, payload, created_at)
    VALUES (CASE WHEN MOD(i, 4) = 0 THEN 'ai.validation' WHEN MOD(i, 4) = 1 THEN 'stock.updated' WHEN MOD(i, 4) = 2 THEN 'document.extracted' ELSE 'order.received' END,
            CASE WHEN MOD(i, 10) = 0 THEN 'critical' WHEN MOD(i, 3) = 0 THEN 'warning' ELSE 'info' END,
            'seed', event_ref, 'system', JSON_OBJECT('deterministic', TRUE, 'sequence', i), DATE_SUB('2025-09-25 12:00:00', INTERVAL i * 12 MINUTE));
    SET i = i + 1;
  END WHILE;

  SET i = 1;
  WHILE i <= 12 DO
    SET receipt_ref = CONCAT('REC-2025-MOCK-', LPAD(i, 4, '0'));
    INSERT INTO goods_receipts (receipt_number, order_id, warehouse_id, dock_code, status, expected_at)
    SELECT receipt_ref, o.id, w.id, CONCAT('Muelle ', LPAD(MOD(i - 1, 4) + 1, 2, '0')),
           CASE WHEN MOD(i, 4) = 1 THEN 'unloading' WHEN MOD(i, 4) = 2 THEN 'in_transit' WHEN MOD(i, 4) = 3 THEN 'scheduled' ELSE 'available' END,
           DATE_ADD('2025-09-25 09:00:00', INTERVAL i * 45 MINUTE)
    FROM orders o JOIN warehouses w ON w.code = 'MAD-01'
    WHERE o.external_id = CONCAT('PED-2025-MOCK-', LPAD(i, 4, '0'))
    ON DUPLICATE KEY UPDATE status = VALUES(status), expected_at = VALUES(expected_at);
    SET i = i + 1;
  END WHILE;
END$$
DELIMITER ;

CALL seed_abundant_mock_data();
DROP PROCEDURE IF EXISTS seed_abundant_mock_data;
