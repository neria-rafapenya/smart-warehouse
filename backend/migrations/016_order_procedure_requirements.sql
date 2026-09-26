INSERT IGNORE INTO order_procedures (order_id, procedure_id, status)
SELECT o.id, rp.id, 'missing'
FROM orders o
CROSS JOIN required_procedures rp
WHERE rp.active = TRUE;
