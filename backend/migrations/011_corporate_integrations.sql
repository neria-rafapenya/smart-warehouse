USE smart_warehouse;

CREATE TABLE IF NOT EXISTS integration_connections (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  protocol VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'configured',
  endpoint VARCHAR(512),
  configuration_json JSON,
  secret_reference VARCHAR(160),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS integration_sync_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  integration_id BIGINT NOT NULL,
  direction VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL,
  records_count INT NOT NULL DEFAULT 0,
  response_json JSON,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  CONSTRAINT fk_sync_integration FOREIGN KEY (integration_id) REFERENCES integration_connections(id)
) ENGINE=InnoDB;

INSERT INTO integration_connections (code, name, kind, protocol, status, endpoint, configuration_json, secret_reference) VALUES
('ERP-DEMO', 'ERP corporativo', 'erp', 'REST', 'configured', 'https://erp.example.invalid/api', JSON_OBJECT('direction', 'bidirectional', 'resources', JSON_ARRAY('orders', 'suppliers', 'stock')), 'ERP_API_TOKEN'),
('WMS-DEMO', 'WMS corporativo', 'wms', 'REST', 'configured', 'https://wms.example.invalid/api', JSON_OBJECT('direction', 'bidirectional', 'resources', JSON_ARRAY('stock', 'receipts', 'movements')), 'WMS_API_TOKEN'),
('ACCOUNTING-DEMO', 'Software contable', 'accounting', 'REST', 'configured', 'https://accounting.example.invalid/api', JSON_OBJECT('direction', 'outbound', 'resources', JSON_ARRAY('invoices', 'exports')), 'ACCOUNTING_API_TOKEN'),
('SUPPLIER-API-DEMO', 'APIs de proveedores', 'supplier', 'REST', 'configured', 'https://supplier.example.invalid/api', JSON_OBJECT('direction', 'outbound', 'resources', JSON_ARRAY('catalog', 'availability', 'prices')), 'SUPPLIER_API_TOKEN'),
('EDI-DEMO', 'Gateway EDI', 'edi', 'AS2/EDIFACT', 'configured', 'https://edi.example.invalid/as2', JSON_OBJECT('direction', 'bidirectional', 'messages', JSON_ARRAY('ORDERS', 'DESADV', 'INVOIC')), 'EDI_CERTIFICATE_REFERENCE')
ON DUPLICATE KEY UPDATE name = VALUES(name), protocol = VALUES(protocol), configuration_json = VALUES(configuration_json);
