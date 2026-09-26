variable "name" { type = string }
variable "environment" { type = string }
resource "aws_secretsmanager_secret" "application" {
  name                    = "${var.name}/${var.environment}/application"
  recovery_window_in_days = 7
}
output "application_secret_arn" { value = aws_secretsmanager_secret.application.arn }
