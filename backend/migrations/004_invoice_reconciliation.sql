USE smart_warehouse;

CREATE TABLE IF NOT EXISTS invoice_reconciliations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  invoice_id BIGINT NOT NULL,
  order_id BIGINT,
  receipt_id BIGINT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  confidence DECIMAL(5,4),
  checks_json JSON NOT NULL,
  reviewed_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reconciliation_invoice (invoice_id),
  CONSTRAINT fk_reconciliation_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_reconciliation_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_reconciliation_receipt FOREIGN KEY (receipt_id) REFERENCES goods_receipts(id)
) ENGINE=InnoDB;

CREATE INDEX ix_reconciliation_status ON invoice_reconciliations(status);
