USE smart_warehouse;

INSERT INTO supplier_products (supplier_id, product_id, supplier_sku, unit_cost, currency, minimum_order_quantity, lead_time_days, is_preferred)
SELECT s.id, p.id,
       CONCAT(s.code, '-', p.sku),
       ROUND(4.50 + MOD(CRC32(CONCAT(s.code, p.sku)), 1800) / 100, 2),
       'EUR',
       1,
       s.lead_time_days,
       CASE WHEN s.code = 'SALTOKI' THEN TRUE ELSE FALSE END
FROM suppliers s CROSS JOIN products p
ON DUPLICATE KEY UPDATE supplier_sku = VALUES(supplier_sku), unit_cost = VALUES(unit_cost), lead_time_days = VALUES(lead_time_days);
