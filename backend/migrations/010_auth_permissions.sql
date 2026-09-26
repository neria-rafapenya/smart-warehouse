USE smart_warehouse;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL AFTER role;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(40) NOT NULL,
  permission_id BIGINT NOT NULL,
  PRIMARY KEY (role, permission_id),
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_warehouses (
  user_id BIGINT NOT NULL,
  warehouse_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, warehouse_id),
  CONSTRAINT fk_user_warehouses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_warehouses_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO permissions (code, description) VALUES
('warehouse.read', 'Consultar stock y recepciones'),
('warehouse.write', 'Registrar movimientos y recepciones'),
('purchasing.read', 'Consultar pedidos y proveedores'),
('purchasing.write', 'Crear y avanzar pedidos'),
('administration.read', 'Consultar configuración y usuarios'),
('administration.write', 'Administrar permisos y reglas'),
('ai.read', 'Consultar sugerencias y análisis IA'),
('ai.run', 'Ejecutar análisis IA persistentes'),
('audit.read', 'Consultar eventos y auditoría')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role, permission_id)
SELECT 'administrator', id FROM permissions
ON DUPLICATE KEY UPDATE role = VALUES(role);

INSERT INTO role_permissions (role, permission_id)
SELECT 'purchasing', id FROM permissions WHERE code IN ('purchasing.read', 'purchasing.write', 'warehouse.read', 'ai.read', 'ai.run', 'audit.read')
ON DUPLICATE KEY UPDATE role = VALUES(role);

INSERT INTO role_permissions (role, permission_id)
SELECT 'warehouse_manager', id FROM permissions WHERE code IN ('warehouse.read', 'warehouse.write', 'purchasing.read', 'ai.read', 'ai.run', 'audit.read')
ON DUPLICATE KEY UPDATE role = VALUES(role);

INSERT INTO role_permissions (role, permission_id)
SELECT 'operator', id FROM permissions WHERE code IN ('warehouse.read', 'warehouse.write', 'ai.read')
ON DUPLICATE KEY UPDATE role = VALUES(role);

UPDATE users
SET password_hash = 'c21hcnQtd2FyZWhvdXNlLWRlbW8tc2FsdA==$btpeoTIgv0bJM4MZCHd4Cy9nFdbo12x2w6vgQlI3E6U='
WHERE password_hash IS NULL;

INSERT INTO user_warehouses (user_id, warehouse_id)
SELECT u.id, w.id FROM users u CROSS JOIN warehouses w
ON DUPLICATE KEY UPDATE user_id = VALUES(user_id);
