# Infraestructura AWS preparada, sin despliegue

La configuración de `environments/dev` define la arquitectura futura, pero no se ha ejecutado `apply` ni se han creado recursos AWS. Los módulos están desactivados donde podrían generar coste (`enable_rds = false` y `enable_ecs_service = false`).

`VPC → ECS/Fargate (FastAPI) → RDS MySQL`
`S3 documentos → SQS + DLQ → EventBridge`
`Secrets Manager → credenciales y referencias de integración`

Componentes preparados:

- `modules/network`: VPC y subredes públicas/privadas en dos zonas.
- `modules/compute-ecs`: cluster ECS y definición Fargate para FastAPI; el servicio queda pendiente de añadir balanceador e IAM corporativo.
- `modules/database`: RDS MySQL privado, backup y grupo de subredes.
- `modules/documents`: S3 cifrado, bloqueado públicamente y eliminación de documentos temporales a los 6 días.
- `modules/messaging`: SQS con DLQ y bus EventBridge.
- `modules/secrets`: Secrets Manager sin valores escritos en Terraform.

## Uso seguro

Desde este directorio no ejecutar `apply` todavía. Cuando se autorice un entorno AWS:

```bash
cd terraform/environments/dev
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check -recursive ../../
terraform validate
terraform plan -out=tfplan
```

Revisar especialmente región, nombre global del bucket, tamaño RDS, roles IAM, subredes con salida a Internet/NAT, alarmas y presupuesto antes de aplicar. `terraform.tfvars` está excluido de Git; nunca introducir contraseñas ni tokens en los ficheros `.tf`.

La alternativa Lambda queda abierta para una futura adaptación de FastAPI mediante Mangum y API Gateway; ECS/Fargate es la opción inicial porque mantiene una API persistente y facilita procesos de OCR/sincronización.
