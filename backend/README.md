# Backend · Smart Warehouse

Base de Fase 2 preparada con arquitectura hexagonal. La API aún no se activa en la demo de Fase 1; los adaptadores de React consumen `src/adapters/mockWarehouseRepository.js` y podrán cambiar a HTTP sin tocar las pantallas.

La integración prevista es **React → FastAPI REST → casos de uso → repositorios MySQL**. Ningún código del frontend tendrá credenciales ni conexión directa a MySQL. En AWS, FastAPI será desplegado detrás de un balanceador/API Gateway y MySQL permanecerá en una red privada.

```text
backend/
├── app/
│   ├── domain/          # Entidades y reglas de negocio
│   ├── application/     # Casos de uso / puertos
│   ├── adapters/
│   │   ├── inbound/     # API REST, jobs de importación
│   │   └── outbound/    # MySQL, almacenamiento documental, ERP
│   └── config/
├── migrations/
├── templates/           # Plantillas Excel/CSV versionadas
└── tests/
```

El usuario MySQL local previsto es `root`, password `root`, base `smart_warehouse`.

## Inicializar MySQL local

Con XAMPP iniciado, ejecutar desde la raíz del proyecto:

```bash
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/001_initial_schema.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/002_seed_mock_data.sql
```

En esta instalación concreta de XAMPP, `root` está configurado sin contraseña; la configuración objetivo del proyecto sigue siendo `MYSQL_PASSWORD=root` y se resolverá mediante `.env` cuando se configure el entorno local definitivo.

El esquema actual crea 19 tablas para almacenes, ubicaciones, catálogo, proveedores, stock, pedidos, validaciones, recepciones, documentos, facturas, procedimientos, auditoría y notificaciones.
