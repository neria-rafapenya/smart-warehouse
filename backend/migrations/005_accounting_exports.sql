USE smart_warehouse;

CREATE TABLE IF NOT EXISTS invoice_accounting_exports (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  invoice_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  export_format VARCHAR(16),
  target_system VARCHAR(120),
  external_reference VARCHAR(120),
  payload_json JSON,
  exported_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_accounting_export_invoice (invoice_id),
  CONSTRAINT fk_accounting_export_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  INDEX ix_accounting_export_status (status)
) ENGINE=InnoDB;

INSERT INTO invoice_accounting_exports (invoice_id, status)
SELECT i.id, CASE WHEN i.status = 'exportable' THEN 'exportable' ELSE 'pending' END
FROM invoices i
LEFT JOIN invoice_accounting_exports e ON e.invoice_id = i.id
WHERE e.id IS NULL;
