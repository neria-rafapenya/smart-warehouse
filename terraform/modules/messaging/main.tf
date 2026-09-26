variable "name" { type = string }
variable "environment" { type = string }
resource "aws_sqs_queue" "dlq" { name = "${var.name}-${var.environment}-dlq" }
resource "aws_sqs_queue" "integration" {
  name           = "${var.name}-${var.environment}-integration"
  redrive_policy = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq.arn, maxReceiveCount = 3 })
}
resource "aws_cloudwatch_event_bus" "this" { name = "${var.name}-${var.environment}" }
output "queue_url" { value = aws_sqs_queue.integration.url }
output "queue_arn" { value = aws_sqs_queue.integration.arn }
output "event_bus_name" { value = aws_cloudwatch_event_bus.this.name }
