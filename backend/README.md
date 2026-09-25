# Backend · Smart Warehouse

Base de Fase 2 preparada con arquitectura hexagonal. La API aún no se activa en la demo de Fase 1; los adaptadores de React consumen `src/adapters/mockWarehouseRepository.js` y podrán cambiar a HTTP sin tocar las pantallas.

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
