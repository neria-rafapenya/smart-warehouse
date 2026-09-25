# Backend · Smart Warehouse

Base de Fase 2 preparada con arquitectura hexagonal. La demo React consume esta API REST; las pantallas dependen de un repositorio de aplicación y no de MySQL ni de datos mock embebidos.

La integración prevista es **React → FastAPI REST → casos de uso → repositorios MySQL**. Ningún código del frontend tendrá credenciales ni conexión directa a MySQL. En AWS, FastAPI será desplegado detrás de un balanceador/API Gateway y MySQL permanecerá en una red privada.

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
- `POST /api/v1/orders` — crea un pedido pendiente y registra su decisión determinista.
- `POST /api/v1/imports/orders` — importa pedidos desde `.csv` o `.xlsx`.
- `POST /api/v1/orders/{external_id}/validate`
- `GET /api/v1/stock`
- `GET /api/v1/suppliers`
- `GET /api/v1/documents/invoices`
- `POST /api/v1/documents/invoices` — recibe una factura PDF, extrae sus campos y la guarda en almacenamiento local.
- `POST /api/v1/documents/invoices/{invoice_number}/reconcile` — ejecuta la conciliación automática de factura, pedido y recepción.
- `GET /api/v1/documents/procedures` — resumen de procedimientos obligatorios pendientes.
- `GET /api/v1/orders/{external_id}/procedures` — estado documental de un pedido.
- `POST /api/v1/orders/{external_id}/procedures/{procedure_code}/documents` — adjunta el documento obligatorio a un pedido.
- `GET /api/v1/events?limit=50`
- `GET /api/v1/alerts?limit=50` — alertas pendientes desde `notifications` y `audit_events`.
- `GET /api/v1/orders/{external_id}/decisions` — decisiones persistidas del motor determinista/IA.

## Facturas PDF y documentos obligatorios

Las facturas digitales se procesan con `pypdf`. Se extraen de forma determinista el proveedor mediante NIF, número, fecha, moneda, subtotal, impuestos y total. Si el PDF no contiene una capa de texto, la API detecta el caso, rasteriza sus páginas con `pdftoppm` y ejecuta OCR con Tesseract (`spa+eng`). Los campos obtenidos por OCR tienen confianza reducida y el documento queda siempre en `pending_review`, aunque se hayan encontrado todos los campos, para que una persona valide el resultado.

El resultado conserva trazabilidad en `documents.extracted_json`: origen de extracción (`digital` u `ocr`), confianza por campo, campos con baja confianza, razones de revisión y metadatos del OCR. Si las herramientas OCR no están instaladas, la factura no se pierde: queda pendiente de revisión con una razón explícita. En local se necesitan Tesseract y Poppler (`pdftoppm`); su empaquetado para Docker/AWS se resolverá en la Fase 3.

## Conciliación automática

Al registrar una factura se lanza una conciliación determinista de tres vías. Se busca el pedido del mismo proveedor y se comparan proveedor, líneas y cantidades si la factura contiene líneas estructuradas, impuestos y total. Después se localiza la recepción vinculada al pedido y se comprueba que las cantidades recibidas cubren las esperadas. El resultado se persiste en `invoice_reconciliations`, se registra en auditoría y las diferencias generan una notificación para revisión humana.

Los archivos se guardan únicamente en local bajo `backend/storage/local/`, excluido de Git. En AWS esta misma interfaz se sustituirá por un adaptador de objetos, previsiblemente S3, sin cambiar los casos de uso ni la API.

Los procedimientos iniciales son `PURCHASE_APPROVAL`, `RECEIVING_CHECK` e `INVOICE_MATCH`. Un documento subido a un procedimiento se vincula a `order_procedures`, pasa a `complete` y queda auditado.

## Plantilla de importación de pedidos

La plantilla versionada está en `backend/templates/order_import_columns.csv`. La primera fila debe contener estas columnas:

```text
external_order_id,sku,product_description,quantity,unit_price,currency,supplier_code,requested_by,requested_at,required_procedure_code
```

Son obligatorias `sku`, `quantity`, `unit_price` y `supplier_code`; el resto permite conservar trazabilidad documental y podrá ampliarse sin acoplar el frontend al formato concreto del proveedor. El endpoint devuelve filas importadas y errores por fila para revisión humana.
