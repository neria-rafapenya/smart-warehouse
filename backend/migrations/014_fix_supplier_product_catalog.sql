USE smart_warehouse;

DELETE sp
FROM supplier_products sp
JOIN suppliers s ON s.id = sp.supplier_id
JOIN products p ON p.id = sp.product_id
WHERE (s.code = 'ROCA' AND p.brand <> 'Roca')
   OR (s.code = 'GCABLE' AND p.brand <> 'General Cable')
   OR (s.code = 'SONEPAR' AND p.category <> 'Electricidad');

INSERT IGNORE INTO supplier_products (supplier_id, product_id, supplier_sku, unit_cost, currency, minimum_order_quantity, lead_time_days, is_preferred)
SELECT s.id, p.id,
       CONCAT(s.code, '-', p.sku),
       ROUND(4.50 + MOD(CRC32(CONCAT(s.code, p.sku)), 1800) / 100, 2),
       'EUR', 1, s.lead_time_days,
       CASE WHEN s.code = 'SALTOKI' THEN TRUE ELSE FALSE END
FROM suppliers s CROSS JOIN products p
WHERE s.code = 'SALTOKI'
   OR (s.code = 'ROCA' AND p.brand = 'Roca')
   OR (s.code = 'GCABLE' AND p.brand = 'General Cable')
   OR (s.code = 'SONEPAR' AND p.category = 'Electricidad');
