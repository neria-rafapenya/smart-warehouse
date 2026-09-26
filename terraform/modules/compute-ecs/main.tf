variable "enabled" { type = bool }
variable "name" { type = string }
variable "environment" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "vpc_id" { type = string }
variable "container_image" { type = string }
variable "container_port" { type = number }
variable "desired_count" { type = number }
variable "sqs_queue_arn" { type = string }
variable "documents_bucket" { type = string }
resource "aws_ecs_cluster" "this" { name = "${var.name}-${var.environment}" }

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  count              = var.enabled ? 1 : 0
  name               = "${var.name}-${var.environment}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  count      = var.enabled ? 1 : 0
  role       = aws_iam_role.execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_cloudwatch_log_group" "api" {
  count             = var.enabled ? 1 : 0
  name              = "/ecs/${var.name}/${var.environment}"
  retention_in_days = 14
}
resource "aws_ecs_task_definition" "api" {
  count                    = var.enabled ? 1 : 0
  family                   = "${var.name}-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution[0].arn
  container_definitions    = jsonencode([{ name = "api", image = var.container_image, essential = true, portMappings = [{ containerPort = var.container_port, protocol = "tcp" }], logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = aws_cloudwatch_log_group.api[0].name, "awslogs-region" = "eu-south-2", "awslogs-stream-prefix" = "api" } } }])
}
output "cluster_name" { value = aws_ecs_cluster.this.name }
