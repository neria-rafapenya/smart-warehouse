CREATE DATABASE IF NOT EXISTS smart_warehouse CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_warehouse;

CREATE TABLE IF NOT EXISTS warehouses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  address VARCHAR(255),
  capacity_m3 DECIMAL(14,3),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  role VARCHAR(40) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS suppliers (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL UNIQUE,
  legal_name VARCHAR(190) NOT NULL,
  tax_id VARCHAR(32),
  category VARCHAR(120),
  email VARCHAR(190),
  lead_time_days DECIMAL(8,2),
  rating DECIMAL(3,2),
  status VARCHAR(32) NOT NULL DEFAULT 'connected',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  sku VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL,
  category VARCHAR(120) NOT NULL,
  brand VARCHAR(120),
  unit_of_measure VARCHAR(16) NOT NULL DEFAULT 'unit',
  size_m3 DECIMAL(12,6),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS supplier_products (
  supplier_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  supplier_sku VARCHAR(64),
  unit_cost DECIMAL(14,4) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  minimum_order_quantity DECIMAL(14,3) NOT NULL DEFAULT 1,
  lead_time_days DECIMAL(8,2),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (supplier_id, product_id),
  CONSTRAINT fk_supplier_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_supplier_products_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS storage_locations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  warehouse_id BIGINT NOT NULL,
  code VARCHAR(64) NOT NULL,
  zone VARCHAR(32) NOT NULL,
  capacity_m3 DECIMAL(14,3),
  occupied_m3 DECIMAL(14,3) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'available',
  UNIQUE KEY uq_storage_location (warehouse_id, code),
  CONSTRAINT fk_storage_locations_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  warehouse_id BIGINT NOT NULL,
  location_id BIGINT,
  product_id BIGINT NOT NULL,
  quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  reserved_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  minimum_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  reorder_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stock_product_location (warehouse_id, location_id, product_id),
  CONSTRAINT fk_stock_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_stock_location FOREIGN KEY (location_id) REFERENCES storage_locations(id),
  CONSTRAINT fk_stock_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  external_id VARCHAR(64) NOT NULL UNIQUE,
  order_type VARCHAR(32) NOT NULL DEFAULT 'purchase_request',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  risk VARCHAR(16) NOT NULL DEFAULT 'yellow',
  requester_id BIGINT,
  supplier_id BIGINT,
  warehouse_id BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  requested_at DATETIME NOT NULL,
  approved_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_requester FOREIGN KEY (requester_id) REFERENCES users(id),
  CONSTRAINT fk_orders_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_orders_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  INDEX ix_orders_status_risk (status, risk),
  INDEX ix_orders_requested_at (requested_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_lines (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  requested_quantity DECIMAL(14,3) NOT NULL,
  approved_quantity DECIMAL(14,3),
  unit_price DECIMAL(14,4) NOT NULL,
  line_total DECIMAL(14,2) NOT NULL,
  UNIQUE KEY uq_order_product (order_id, product_id),
  CONSTRAINT fk_order_lines_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_lines_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS validation_decisions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  decision_status VARCHAR(32) NOT NULL,
  risk VARCHAR(16) NOT NULL,
  confidence DECIMAL(5,4),
  reasons JSON NOT NULL,
  engine VARCHAR(64) NOT NULL DEFAULT 'deterministic_rules_v1',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_validation_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX ix_validation_order_created (order_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS goods_receipts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  receipt_number VARCHAR(64) NOT NULL UNIQUE,
  order_id BIGINT,
  warehouse_id BIGINT NOT NULL,
  dock_code VARCHAR(32),
  status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
  expected_at DATETIME,
  received_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_receipts_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_receipts_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  receipt_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  expected_quantity DECIMAL(14,3) NOT NULL,
  received_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  CONSTRAINT fk_receipt_lines_receipt FOREIGN KEY (receipt_id) REFERENCES goods_receipts(id) ON DELETE CASCADE,
  CONSTRAINT fk_receipt_lines_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS documents (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  document_type VARCHAR(32) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  mime_type VARCHAR(120),
  extraction_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  confidence DECIMAL(5,4),
  extracted_json JSON,
  uploaded_by BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_documents_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  document_id BIGINT,
  supplier_id BIGINT,
  invoice_number VARCHAR(96) NOT NULL,
  invoice_date DATE,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  subtotal DECIMAL(14,2),
  tax_amount DECIMAL(14,2),
  total DECIMAL(14,2),
  status VARCHAR(32) NOT NULL DEFAULT 'extracted',
  exported_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_invoice (supplier_id, invoice_number),
  CONSTRAINT fk_invoices_document FOREIGN KEY (document_id) REFERENCES documents(id),
  CONSTRAINT fk_invoices_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS required_procedures (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_procedures (
  order_id BIGINT NOT NULL,
  procedure_id BIGINT NOT NULL,
  document_id BIGINT,
  status VARCHAR(32) NOT NULL DEFAULT 'missing',
  checked_at DATETIME,
  PRIMARY KEY (order_id, procedure_id),
  CONSTRAINT fk_order_procedures_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_procedures_procedure FOREIGN KEY (procedure_id) REFERENCES required_procedures(id),
  CONSTRAINT fk_order_procedures_document FOREIGN KEY (document_id) REFERENCES documents(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  event_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  aggregate_type VARCHAR(64),
  aggregate_id VARCHAR(64),
  actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
  actor_id BIGINT,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX ix_audit_created (created_at),
  INDEX ix_audit_severity (severity)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT,
  event_id BIGINT,
  channel VARCHAR(32) NOT NULL DEFAULT 'in_app',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  read_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_notifications_event FOREIGN KEY (event_id) REFERENCES audit_events(id)
) ENGINE=InnoDB;
