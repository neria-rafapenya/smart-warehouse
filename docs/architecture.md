# Arquitectura evolutiva

## Fase 1

React/Vite presenta pantallas y navegación. `domain/mockData.js` contiene el escenario reproducible y `adapters/mockWarehouseRepository.js` implementa el puerto de lectura usado por `application/useWarehouse.js`.

## Fase 2

Los casos de uso viven en `backend/app/application` y solo conocen puertos. Los adaptadores futuros pueden persistir en MySQL, leer Excel/CSV según la plantilla versionada, almacenar PDFs y exponer REST. La salida económica se mantiene como evento/DTO exportable a contabilidad.

## Fase 3

La capa de decisión IA se plantea como un servicio separado: recibe contexto normalizado, devuelve decisión explicable, confianza, razones y eventos. El mismo contrato permite conectar la demo, un ERP/WMS existente, SCADA o APIs corporativas sin acoplar la UI al proveedor de modelos.
