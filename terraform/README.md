# Infraestructura futura AWS

Directorio reservado para Fase 3. No contiene despliegues ni recursos aplicados. La evolución prevista es:

`API Gateway / ALB → ECS o Lambda → RDS MySQL → S3 documentos → EventBridge/SQS → Bedrock o servicio IA → CloudWatch`

Los módulos deberán añadir IAM mínimo, redes privadas, cifrado, secretos gestionados y observabilidad antes de cualquier `plan` en una cuenta real.
