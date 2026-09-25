USE smart_warehouse;

CREATE TABLE IF NOT EXISTS order_status_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  reason VARCHAR(255),
  created_by BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_history_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_history_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX ix_order_history_order_created (order_id, created_at)
) ENGINE=InnoDB;

INSERT INTO order_status_history (order_id, from_status, to_status, reason)
SELECT o.id, NULL, o.status, 'Estado inicial migrado'
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id);
