USE smart_warehouse;

CREATE TABLE IF NOT EXISTS alert_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  event_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  recipients_json JSON NOT NULL,
  channels_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO alert_rules (code, name, description, event_type, severity, enabled, recipients_json, channels_json)
VALUES
  ('ORDER_RISK_REVIEW', 'Pedidos con riesgo', 'Avisar cuando una validación requiere revisión humana', 'ai.validation', 'warning', TRUE, JSON_ARRAY('laura.martin@smartwarehouse.local'), JSON_ARRAY('in_app', 'email')),
  ('INVOICE_REVIEW', 'Facturas pendientes', 'Avisar por datos OCR o conciliación incompleta', 'invoice.reconciliation_review', 'warning', TRUE, JSON_ARRAY('laura.martin@smartwarehouse.local'), JSON_ARRAY('in_app')),
  ('STOCK_CRITICAL', 'Stock crítico', 'Avisar cuando una referencia cae por debajo del mínimo', 'stock.updated', 'critical', TRUE, JSON_ARRAY('javier.soler@smartwarehouse.local'), JSON_ARRAY('in_app', 'email'))
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);
