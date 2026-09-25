# Smart Warehouse

Demo visual navegable para un distribuidor de material de fontanería y electricidad. La Fase 1 muestra una operación completa: compras con validación semáforo, stock, recepción, proveedores, documentos/facturas, auditoría y un Copilot operativo.

## Arranque local

Requisitos: Node.js 20+ y npm. Apache/XAMPP puede seguir atendiendo el puerto 80; la demo Vite usa el puerto 5173 para no interferir.

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`.

Para compilar la entrega: `npm run build` y `npm run preview`.

La configuración local se documenta en `.env.example`. Los secretos reales deben vivir en un `.env` local, excluido de Git.

## Estructura

```text
src/domain/       datos y conceptos de negocio de la demo
src/application/  casos de uso y servicios de aplicación
src/adapters/     repositorio mock intercambiable por HTTP
backend/          base hexagonal Python + contratos MySQL/importación
terraform/        estructura reservada para AWS, sin despliegues
docs/             decisiones y arquitectura evolutiva
```

## Roadmap

### Fase 1 · Demo visual (actual)

- Navegación de cabecera y menú lateral.
- Dashboard con KPIs, salud operativa e insights.
- Cola de pedidos con decisión verde/amarillo/rojo y explicación.
- Stock, recepción/capacidad, proveedores, facturas y eventos.
- Copilot visible con respuestas mock deterministas.

### Fase 2 · Ecosistema local

- Base MySQL `smart_warehouse` creada con migración y seed inicial.
- API Python FastAPI REST con arquitectura hexagonal, pendiente de implementar.
- Datos abundantes y carga mediante plantilla Excel/CSV versionada.
- Datos abundantes y carga mediante plantilla Excel/CSV versionada.
- Flujo de PDF digital y factura escaneada con extracción trazable.
- Documentos/procedimientos obligatorios, alertas y exportación contable.

### Fase 3 · IA e integración corporativa

- Motor de anomalías y sugerencias detrás de contratos explicables.
- Eventos, logs y decisiones con confianza, razones y auditoría.
- Conectores para ERP, WMS, SCADA y APIs existentes.
- Terraform, CI/CD, observabilidad y arquitectura AWS revisados antes de desplegar.

## Estado de la demo

Los datos son mock y el comportamiento es determinista. No se despliega AWS ni se generan costes en esta fase.
