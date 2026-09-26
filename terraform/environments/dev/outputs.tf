output "vpc_id" { value = module.network.vpc_id }
output "documents_bucket" { value = module.documents.bucket_name }
output "integration_queue_url" { value = module.messaging.queue_url }
output "integration_queue_arn" { value = module.messaging.queue_arn }
output "database_endpoint" {
  value     = module.database.endpoint
  sensitive = true
}
output "ecs_cluster_name" { value = module.api.cluster_name }
