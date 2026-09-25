USE smart_warehouse;

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  warehouse_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  movement_type VARCHAR(32) NOT NULL,
  quantity_delta DECIMAL(14,3) NOT NULL DEFAULT 0,
  reserved_delta DECIMAL(14,3) NOT NULL DEFAULT 0,
  resulting_quantity DECIMAL(14,3) NOT NULL,
  resulting_reserved_quantity DECIMAL(14,3) NOT NULL,
  reference_type VARCHAR(64),
  reference_id VARCHAR(120),
  reason VARCHAR(255),
  created_by BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movements_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_movements_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_movements_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX ix_movements_product_created (product_id, created_at),
  INDEX ix_movements_reference (reference_type, reference_id)
) ENGINE=InnoDB;
