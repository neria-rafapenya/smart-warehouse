# DevOps y operación

## Entornos

| Entorno | Aplicación | Base de datos | Despliegue |
|---|---|---|---|
| Desarrollo | Vite + FastAPI local | XAMPP/MySQL o Docker opcional | Manual |
| Staging | ECS/Fargate preparado | RDS opcional | Plan manual tras CI |
| Producción | ECS/Fargate | RDS MySQL privado | Aprobación manual |

El workflow de CI valida frontend, backend y formato Terraform. No tiene credenciales AWS ni ejecuta `apply`. Un futuro workflow de CD deberá requerir aprobación de entorno y obtener secretos desde GitHub OIDC + AWS IAM, nunca desde el repositorio.

## Docker

La API se empaqueta con `backend/Dockerfile`. Para probar una instalación aislada con MySQL en el puerto local `3307`:

```bash
docker compose --profile docker up --build
```

La instalación habitual con XAMPP sigue siendo válida y no se modifica.

## Logs y métricas

ECS envía logs de FastAPI a CloudWatch Logs con retención inicial de 14 días. Los eventos funcionales permanecen en `audit_events`; las sincronizaciones corporativas en `integration_sync_runs`. Antes de producción hay que añadir alarmas de CPU/memoria ECS, errores 5xx, latencia, profundidad SQS y disponibilidad RDS.

## Backups y recuperación

RDS queda preparado con 7 días de backup automático, subredes privadas y `publicly_accessible = false`. Producción debe activar protección contra borrado, snapshot final y retención definida por negocio. S3 debe versionarse antes de guardar documentos permanentes; los documentos temporales expiran a los 6 días.

Procedimiento mínimo de recuperación:

1. Identificar el incidente en CloudWatch y congelar sincronizaciones.
2. Restaurar RDS a un punto temporal o snapshot en una instancia nueva.
3. Verificar migraciones y consistencia de `audit_events`.
4. Revalidar secretos, endpoints y healthchecks.
5. Reanudar SQS/EventBridge y comprobar pedidos, recepciones y exportaciones contables.
