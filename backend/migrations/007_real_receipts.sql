USE smart_warehouse;

ALTER TABLE goods_receipt_lines
  ADD COLUMN IF NOT EXISTS damaged_quantity DECIMAL(14,3) NOT NULL DEFAULT 0 AFTER received_quantity,
  ADD COLUMN IF NOT EXISTS damage_reason VARCHAR(255) AFTER damaged_quantity;
