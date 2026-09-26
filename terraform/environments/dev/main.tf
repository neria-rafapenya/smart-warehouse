terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags { tags = { Project = "smart-warehouse", Environment = var.environment, ManagedBy = "terraform" } }
}

module "network" {
  source             = "../../modules/network"
  name               = var.project_name
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

module "documents" {
  source          = "../../modules/documents"
  bucket_name     = var.documents_bucket_name
  expiration_days = 6
}

module "messaging" {
  source      = "../../modules/messaging"
  name        = var.project_name
  environment = var.environment
}

module "secrets" {
  source      = "../../modules/secrets"
  name        = var.project_name
  environment = var.environment
}

module "database" {
  source          = "../../modules/database"
  enabled         = var.enable_rds
  name            = var.project_name
  environment     = var.environment
  subnet_ids      = module.network.private_subnet_ids
  vpc_id          = module.network.vpc_id
  master_username = var.rds_master_username
  master_password = var.rds_master_password
  instance_class  = var.rds_instance_class
}

module "api" {
  source             = "../../modules/compute-ecs"
  enabled            = var.enable_ecs_service
  name               = var.project_name
  environment        = var.environment
  private_subnet_ids = module.network.private_subnet_ids
  vpc_id             = module.network.vpc_id
  container_image    = var.api_container_image
  container_port     = 8000
  desired_count      = var.ecs_desired_count
  sqs_queue_arn      = module.messaging.queue_arn
  documents_bucket   = module.documents.bucket_name
}
