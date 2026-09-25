USE smart_warehouse;

INSERT INTO warehouses (code, name, address, capacity_m3) VALUES
('MAD-01', 'Centro logístico Madrid Norte', 'C/ Forja 18, Madrid', 12400.000)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO users (full_name, email, role) VALUES
('Laura Martín', 'laura.martin@smartwarehouse.local', 'administrator'),
('Javier Soler', 'javier.soler@smartwarehouse.local', 'purchasing'),
('Marta Gil', 'marta.gil@smartwarehouse.local', 'warehouse_manager'),
('David Cano', 'david.cano@smartwarehouse.local', 'operator'),
('Ana Ruiz', 'ana.ruiz@smartwarehouse.local', 'purchasing')
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

INSERT INTO suppliers (code, legal_name, tax_id, category, lead_time_days, rating, status) VALUES
('ROCA', 'Roca Sanitario, S.A.', 'A08000123', 'Fontanería', 3, 4.80, 'connected'),
('SALTOKI', 'Saltoki Suministros', 'B31000456', 'Fontanería / Electricidad', 2, 4.60, 'connected'),
('GCABLE', 'General Cable', 'A28000789', 'Electricidad', 5, 4.40, 'review_contract'),
('SONEPAR', 'Sonepar Ibérica', 'A48000987', 'Electricidad', 2, 4.70, 'connected')
ON DUPLICATE KEY UPDATE legal_name = VALUES(legal_name);

INSERT INTO products (sku, description, category, brand, unit_of_measure, size_m3) VALUES
('ROCA-A5A3', 'Grifo Roca monomando cromado', 'Fontanería', 'Roca', 'unit', 0.012),
('PEX-16-ML', 'Tubo multicapa PEX 16 mm', 'Fontanería', 'Standard Hidráulica', 'meter', 0.004),
('RZ1-3G25', 'Cable RZ1-K 3G2.5', 'Electricidad', 'General Cable', 'meter', 0.002),
('BOM-750W', 'Bomba de achique 750 W', 'Fontanería', 'Einhell', 'unit', 0.035),
('LLV-12-ESF', 'Llave de paso esfera 1/2"', 'Fontanería', 'Genebre', 'unit', 0.002),
('LED-PL-24', 'Panel LED 60x60 40W', 'Electricidad', 'Philips', 'unit', 0.018)
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO storage_locations (warehouse_id, code, zone, capacity_m3, occupied_m3, status)
SELECT id, 'A-01-04', 'A', 240, 187.2, 'available' FROM warehouses WHERE code = 'MAD-01'
ON DUPLICATE KEY UPDATE occupied_m3 = VALUES(occupied_m3);
INSERT INTO storage_locations (warehouse_id, code, zone, capacity_m3, occupied_m3, status)
SELECT id, 'B-04-02', 'B', 310, 198.4, 'available' FROM warehouses WHERE code = 'MAD-01'
ON DUPLICATE KEY UPDATE occupied_m3 = VALUES(occupied_m3);
INSERT INTO storage_locations (warehouse_id, code, zone, capacity_m3, occupied_m3, status)
SELECT id, 'C-02-01', 'C', 280, 254.8, 'attention' FROM warehouses WHERE code = 'MAD-01'
ON DUPLICATE KEY UPDATE occupied_m3 = VALUES(occupied_m3);

INSERT INTO stock_items (warehouse_id, location_id, product_id, quantity, minimum_quantity, reorder_quantity)
SELECT w.id, l.id, p.id, x.quantity, x.minimum_quantity, x.reorder_quantity
FROM warehouses w JOIN storage_locations l ON l.warehouse_id = w.id JOIN products p
JOIN (SELECT 'ROCA-A5A3' sku, 86 quantity, 50 minimum_quantity, 100 reorder_quantity UNION ALL
      SELECT 'PEX-16-ML', 1240, 400, 800 UNION ALL
      SELECT 'RZ1-3G25', 2140, 1000, 1500 UNION ALL
      SELECT 'BOM-750W', 7, 12, 20 UNION ALL
      SELECT 'LLV-12-ESF', 340, 90, 200 UNION ALL
      SELECT 'LED-PL-24', 42, 80, 120) x ON x.sku = p.sku
WHERE w.code = 'MAD-01' AND l.code = CASE p.sku WHEN 'ROCA-A5A3' THEN 'A-01-04' WHEN 'PEX-16-ML' THEN 'B-04-02' WHEN 'RZ1-3G25' THEN 'C-02-01' ELSE 'A-01-04' END
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), minimum_quantity = VALUES(minimum_quantity);

INSERT INTO required_procedures (code, name, description) VALUES
('PURCHASE_APPROVAL', 'Aprobación de pedido', 'Validar cantidad, proveedor y presupuesto antes del envío.'),
('RECEIVING_CHECK', 'Checklist de recepción', 'Registrar cantidades, daños y ubicación de entrada.'),
('INVOICE_MATCH', 'Conciliación de factura', 'Contrastar factura con pedido y recepción.')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO orders (external_id, order_type, status, risk, requester_id, supplier_id, warehouse_id, subtotal, tax_amount, total, requested_at)
SELECT 'PED-2025-00482', 'purchase_request', 'pending', 'red', u.id, s.id, w.id, 14710.74, 3089.26, 17800.00, '2025-09-25 09:42:00'
FROM users u, suppliers s, warehouses w WHERE u.email = 'laura.martin@smartwarehouse.local' AND s.code = 'ROCA' AND w.code = 'MAD-01'
ON DUPLICATE KEY UPDATE status = VALUES(status), risk = VALUES(risk), total = VALUES(total);
INSERT INTO orders (external_id, order_type, status, risk, requester_id, supplier_id, warehouse_id, subtotal, tax_amount, total, requested_at)
SELECT 'PED-2025-00481', 'purchase_request', 'approved', 'green', u.id, s.id, w.id, 3748.76, 787.24, 4536.00, '2025-09-25 09:18:00'
FROM users u, suppliers s, warehouses w WHERE u.email = 'javier.soler@smartwarehouse.local' AND s.code = 'SALTOKI' AND w.code = 'MAD-01'
ON DUPLICATE KEY UPDATE status = VALUES(status), risk = VALUES(risk), total = VALUES(total);
INSERT INTO orders (external_id, order_type, status, risk, requester_id, supplier_id, warehouse_id, subtotal, tax_amount, total, requested_at)
SELECT 'PED-2025-00480', 'purchase_request', 'pending', 'yellow', u.id, s.id, w.id, 3272.73, 687.27, 3960.00, '2025-09-25 08:56:00'
FROM users u, suppliers s, warehouses w WHERE u.email = 'marta.gil@smartwarehouse.local' AND s.code = 'GCABLE' AND w.code = 'MAD-01'
ON DUPLICATE KEY UPDATE status = VALUES(status), risk = VALUES(risk), total = VALUES(total);
INSERT INTO orders (external_id, order_type, status, risk, requester_id, supplier_id, warehouse_id, subtotal, tax_amount, total, requested_at)
SELECT 'PED-2025-00479', 'purchase_request', 'approved', 'green', u.id, s.id, w.id, 262.81, 55.19, 318.00, '2025-09-24 17:22:00'
FROM users u, suppliers s, warehouses w WHERE u.email = 'david.cano@smartwarehouse.local' AND s.code = 'SALTOKI' AND w.code = 'MAD-01'
ON DUPLICATE KEY UPDATE status = VALUES(status), risk = VALUES(risk), total = VALUES(total);
INSERT INTO orders (external_id, order_type, status, risk, requester_id, supplier_id, warehouse_id, subtotal, tax_amount, total, requested_at)
SELECT 'PED-2025-00478', 'purchase_request', 'pending', 'yellow', u.id, s.id, w.id, 1175.21, 246.79, 1422.00, '2025-09-24 16:48:00'
FROM users u, suppliers s, warehouses w WHERE u.email = 'ana.ruiz@smartwarehouse.local' AND s.code = 'SALTOKI' AND w.code = 'MAD-01'
ON DUPLICATE KEY UPDATE status = VALUES(status), risk = VALUES(risk), total = VALUES(total);

INSERT INTO order_lines (order_id, product_id, requested_quantity, unit_price, line_total)
SELECT o.id, p.id, x.quantity, x.unit_price, x.line_total
FROM orders o JOIN products p ON 1 = 1 JOIN (SELECT 'PED-2025-00482' external_id, 'ROCA-A5A3' sku, 250 quantity, 71.20 unit_price, 17800.00 line_total UNION ALL
  SELECT 'PED-2025-00481', 'PEX-16-ML', 840, 5.40, 4536.00 UNION ALL
  SELECT 'PED-2025-00480', 'RZ1-3G25', 1200, 3.30, 3960.00 UNION ALL
  SELECT 'PED-2025-00479', 'LLV-12-ESF', 60, 5.30, 318.00 UNION ALL
  SELECT 'PED-2025-00478', 'BOM-750W', 18, 79.00, 1422.00) x ON x.external_id = o.external_id AND x.sku = p.sku
ON DUPLICATE KEY UPDATE requested_quantity = VALUES(requested_quantity), unit_price = VALUES(unit_price), line_total = VALUES(line_total);
