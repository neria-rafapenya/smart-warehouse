USE smart_warehouse;

ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS supplier_sku VARCHAR(64) NULL AFTER product_id;
