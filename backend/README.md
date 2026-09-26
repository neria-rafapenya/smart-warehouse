# Backend · Smart Warehouse

Base de Fase 2 preparada con arquitectura hexagonal. La demo React consume esta API REST; las pantallas dependen de un repositorio de aplicación y no de MySQL ni de datos mock embebidos.

La integración prevista es **React → FastAPI REST → casos de uso → repositorios MySQL**. Ningún código del frontend tendrá credenciales ni conexión directa a MySQL. En AWS, FastAPI será desplegado detrás de un balanceador/API Gateway y MySQL permanecerá en una red privada.

## Capa de inteligencia artificial desacoplada

La IA se ejecuta inicialmente con `LocalDeterministicAIProvider`: reglas explicables y estadística descriptiva sobre los datos de MySQL local. No realiza llamadas a AWS ni consume modelos externos. El proveedor está detrás del puerto `AIProvider`, por lo que posteriormente se podrá añadir Bedrock u otro proveedor sin cambiar los casos de uso ni la API.

Casos disponibles en local:

- `GET /api/v1/ai/anomalies` — anomalías de volumen y precio.
- `POST /api/v1/ai/anomalies/run` — ejecuta y persiste eventos/avisos de anomalías.
- `GET /api/v1/ai/demand?sku=...` — previsión determinista a 30 días.
- `GET /api/v1/ai/suppliers/compare` — ranking explicable por valoración y plazo.
- `GET /api/v1/ai/suggestions` — sugerencias de reposición y revisión de pedidos.
- `POST /api/v1/ai/suggestions/run` — persiste las sugerencias como eventos.
- `POST /api/v1/ai/chat` — chatbot local conectado a pedidos, stock, proveedores y eventos.

Las operaciones `run` escriben en `audit_events` y generan notificaciones cuando procede. El chatbot registra cada consulta como `ai.chat_query`, dejando trazabilidad de las fuentes utilizadas. Las respuestas incluyen `engine: local_deterministic_v1` para hacer visible que todavía no se ha usado un modelo generativo.

En macOS, el repositorio usa `MYSQL_USE_PURE=true` por defecto. Esto evita la extensión nativa C de `mysql-connector-python`, que puede producir `EXC_BAD_ACCESS` al abrir varias conexiones concurrentes con Python 3.13.

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
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/003_seed_abundant_deterministic_data.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/004_invoice_reconciliation.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/005_accounting_exports.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/006_alert_management.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/007_real_receipts.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/008_stock_movements.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/009_order_workflow.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/010_auth_permissions.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/011_corporate_integrations.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/012_supplier_product_offers.sql
/Applications/XAMPP/xamppfiles/bin/mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < backend/migrations/013_order_supplier_reference.sql
```

En esta instalación concreta de XAMPP, `root` está configurado sin contraseña; la configuración objetivo del proyecto sigue siendo `MYSQL_PASSWORD=root` y se resolverá mediante `.env` cuando se configure el entorno local definitivo.

El esquema actual crea 19 tablas para almacenes, ubicaciones, catálogo, proveedores, stock, pedidos, validaciones, recepciones, documentos, facturas, procedimientos, auditoría y notificaciones. El tercer seed genera 48 productos adicionales, 60 pedidos, 24 facturas y 100 eventos reproducibles.

## Arrancar la API REST

```bash
cd backend
source .venv/bin/activate
MYSQL_PASSWORD='' uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Documentación interactiva: `http://localhost:8000/docs`.

Endpoints iniciales:

- `GET /api/v1/health`
- `GET /api/v1/dashboard`
- `GET /api/v1/orders?status=pending`
- `GET /api/v1/orders/{external_id}`
- `POST /api/v1/orders/{external_id}/status` — ejecuta una transición controlada del flujo.
- `GET /api/v1/orders/{external_id}/status-history` — historial completo de estados.
- `POST /api/v1/orders` — crea un pedido pendiente y registra su decisión determinista.
- `POST /api/v1/imports/orders` — valida y, con `confirm=true`, importa pedidos desde `.csv` o `.xlsx`; sin confirmación devuelve vista previa.
- `POST /api/v1/orders/{external_id}/validate`
- `GET /api/v1/stock`
- `GET /api/v1/suppliers`
- `GET /api/v1/documents/invoices`
- `POST /api/v1/documents/invoices` — recibe una factura PDF, extrae sus campos y la guarda en almacenamiento local.
- `POST /api/v1/documents/invoices/{invoice_number}/reconcile` — ejecuta la conciliación automática de factura, pedido y recepción.
- `GET /api/v1/documents/invoices/accounting-export?format=csv|xlsx` — descarga el fichero contable normalizado.
- `POST /api/v1/documents/invoices/{invoice_number}/accounting-export` — envía la factura al adaptador REST contable y la marca como `exported`.
- `GET /api/v1/documents/procedures` — resumen de procedimientos obligatorios pendientes.
- `GET /api/v1/orders/{external_id}/procedures` — estado documental de un pedido.
- `POST /api/v1/orders/{external_id}/procedures/{procedure_code}/documents` — adjunta el documento obligatorio a un pedido.
- `GET /api/v1/events?limit=50&severity=warning&event_type=ai.validation&aggregate_type=order` — registro filtrable.
- `GET /api/v1/events/{id}` — detalle con payload completo.
- `GET /api/v1/receipts`
- `POST /api/v1/receipts` — registra entrada, cantidades recibidas, daños y diferencias contra el pedido.
- `GET /api/v1/stock/movements?sku=...&limit=100` — historial de movimientos, opcionalmente por SKU.
- `POST /api/v1/stock/movements` — registra entrada, salida, reserva, liberación o ajuste y actualiza stock de forma transaccional.
- `GET /api/v1/events/export?format=csv|xlsx` — exporta el registro normalizado con payload.
- `GET /api/v1/alerts?limit=50&severity=warning&event_type=ai.validation&status=unread` — alertas filtrables desde `notifications` y `audit_events`.
- `POST /api/v1/alerts/{id}/read` y `POST /api/v1/alerts/read-all` — marcan alertas como leídas.
- `GET/POST/PATCH /api/v1/alert-rules` — consulta y configura reglas, gravedad, canales y destinatarios.
- `GET /api/v1/orders/{external_id}/decisions` — decisiones persistidas del motor determinista/IA.

## Facturas PDF y documentos obligatorios

Las facturas digitales se procesan con `pypdf`. Se extraen de forma determinista el proveedor mediante NIF, número, fecha, moneda, subtotal, impuestos y total. Si el PDF no contiene una capa de texto, la API detecta el caso, rasteriza sus páginas con `pdftoppm` y ejecuta OCR con Tesseract (`spa+eng`). Los campos obtenidos por OCR tienen confianza reducida y el documento queda siempre en `pending_review`, aunque se hayan encontrado todos los campos, para que una persona valide el resultado.

El resultado conserva trazabilidad en `documents.extracted_json`: origen de extracción (`digital` u `ocr`), confianza por campo, campos con baja confianza, razones de revisión y metadatos del OCR. Si las herramientas OCR no están instaladas, la factura no se pierde: queda pendiente de revisión con una razón explícita. En local se necesitan Tesseract y Poppler (`pdftoppm`); su empaquetado para Docker/AWS se resolverá en la Fase 3.

## Conciliación automática

Al registrar una factura se lanza una conciliación determinista de tres vías. Se busca el pedido del mismo proveedor y se comparan proveedor, líneas y cantidades si la factura contiene líneas estructuradas, impuestos y total. Después se localiza la recepción vinculada al pedido y se comprueba que las cantidades recibidas cubren las esperadas. El resultado se persiste en `invoice_reconciliations`, se registra en auditoría y las diferencias generan una notificación para revisión humana.

## Exportación contable

La tabla `invoice_accounting_exports` controla el ciclo `pending → exportable → exported`. El fichero CSV/Excel utiliza un contrato normalizado con número y fecha de factura, proveedor, NIF, moneda, subtotal, impuestos, total, pedido, recepción y estados de conciliación. La llamada de envío actual es un adaptador REST local determinista: deja registrada la referencia externa y el sistema destino, preparado para sustituirlo por el endpoint del software contable corporativo sin acoplar el frontend ni los casos de uso.

## Gestión de alertas

La tabla `alert_rules` persiste reglas activas, tipo de evento, gravedad, canales y destinatarios. Las notificaciones pueden filtrarse por gravedad y tipo, marcarse individualmente o en bloque como leídas y quedan auditadas sin eliminar el histórico.

## Integraciones corporativas

La migración `011_corporate_integrations.sql` registra conexiones para ERP, WMS, software contable, APIs de proveedores y EDI. En local se usan adaptadores simulados sin tráfico de red; cada healthcheck y sincronización queda registrado en `integration_sync_runs` y `audit_events`. En producción se podrán sustituir por conectores REST, SOAP, AS2/EDIFACT o adaptadores nativos manteniendo el mismo puerto.

- `GET /api/v1/integrations` — conexiones configuradas.
- `GET /api/v1/integrations/health` — prueba determinista de disponibilidad.
- `POST /api/v1/integrations/{code}/sync` — ejecuta una sincronización simulada y audita el resultado.

## Recepciones reales

`POST /api/v1/receipts` registra una recepción contra un pedido y sus SKU. Para cada línea compara la cantidad solicitada con la recibida y la dañada. Las diferencias actualizan el estado de la recepción a `discrepancy`, generan un evento `receipt.registered` y crean una alerta para revisión; las entradas completas quedan como `received`.

## Movimientos de stock

`stock_movements` conserva cada entrada, salida, reserva, liberación y ajuste con sus deltas y saldos resultantes. El caso de uso bloquea la fila de stock durante la operación, evita salidas o reservas imposibles, actualiza `stock_items` y registra un evento de auditoría en la misma transacción.

## Flujo de pedidos

Los pedidos siguen las transiciones `pending → validated → approved → sent_to_supplier → received → closed`. El API rechaza saltos inválidos, persiste cada cambio en `order_status_history` y registra un evento `order.status_changed`. Los pedidos bloqueados o en revisión pueden volver a `pending` antes de continuar.

Los archivos se guardan únicamente en local bajo `backend/storage/local/`, excluido de Git. En AWS esta misma interfaz se sustituirá por un adaptador de objetos, previsiblemente S3, sin cambiar los casos de uso ni la API.

Los procedimientos iniciales son `PURCHASE_APPROVAL`, `RECEIVING_CHECK` e `INVOICE_MATCH`. Un documento subido a un procedimiento se vincula a `order_procedures`, pasa a `complete` y queda auditado.

## Plantilla de importación de pedidos

Las plantillas físicas versionadas están en `backend/templates/order_import_columns.csv` y `backend/templates/order_import_columns.xlsx`. La primera fila debe contener estas columnas:

```text
external_order_id,sku,product_description,quantity,unit_price,currency,supplier_code,requested_by,requested_at,required_procedure_code
```

Son obligatorias `sku`, `quantity`, `unit_price` y `supplier_code`; el resto permite conservar trazabilidad documental y podrá ampliarse sin acoplar el frontend al formato concreto del proveedor. El endpoint devuelve filas importadas y errores por fila para revisión humana.

La importación se realiza en dos pasos: primero devuelve una vista previa con validación de columnas, filas válidas y duplicados contra MySQL; después `confirm=true` importa únicamente las filas válidas. La interfaz permite descargar el informe CSV de errores antes de confirmar.
## Autenticación y permisos locales

La migración `010_auth_permissions.sql` añade credenciales locales, permisos funcionales y asignación de usuarios a almacenes. La API usa tokens firmados localmente para la demo y bloquea las rutas según el permiso requerido (`warehouse`, `purchasing`, `administration`, `ai` y `audit`). Las acciones de autenticación y los eventos de negocio quedan preparados para identificar al usuario.

Ejecutar después de las migraciones anteriores:

```bash
mysql -u root -proot smart_warehouse < migrations/010_auth_permissions.sql
```

Usuario demo: `laura.martin@smartwarehouse.local` / `demo1234`. Antes de cualquier entorno compartido hay que sustituir la contraseña demo y `AUTH_SECRET` en `.env`.
