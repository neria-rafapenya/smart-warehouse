variable "enabled" { type = bool }
variable "name" { type = string }
variable "environment" { type = string }
variable "subnet_ids" { type = list(string) }
variable "vpc_id" { type = string }
variable "master_username" { type = string }
variable "master_password" {
  type      = string
  sensitive = true
}
variable "instance_class" { type = string }
resource "aws_db_subnet_group" "this" {
  count      = var.enabled ? 1 : 0
  name       = "${var.name}-${var.environment}"
  subnet_ids = var.subnet_ids
}
resource "aws_db_instance" "this" {
  count                     = var.enabled ? 1 : 0
  identifier                = "${var.name}-${var.environment}"
  engine                    = "mysql"
  engine_version            = "8.0"
  instance_class            = var.instance_class
  allocated_storage         = 20
  storage_type              = "gp3"
  db_name                   = "smart_warehouse"
  username                  = var.master_username
  password                  = var.master_password
  db_subnet_group_name      = aws_db_subnet_group.this[0].name
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${var.name}-${var.environment}-final" : null
  deletion_protection       = var.environment == "production"
  publicly_accessible       = false
  backup_retention_period   = 7
}
output "endpoint" {
  value     = try(aws_db_instance.this[0].address, null)
  sensitive = true
}
