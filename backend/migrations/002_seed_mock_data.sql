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
