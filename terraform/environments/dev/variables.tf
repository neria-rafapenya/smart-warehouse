variable "aws_region" {
  type    = string
  default = "eu-south-2"
}
variable "environment" {
  type    = string
  default = "dev"
}
variable "project_name" {
  type    = string
  default = "smart-warehouse"
}
variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}
variable "availability_zones" {
  type    = list(string)
  default = ["eu-south-2a", "eu-south-2b"]
}
variable "documents_bucket_name" {
  type    = string
  default = ""
}
variable "enable_rds" {
  type    = bool
  default = false
}
variable "enable_ecs_service" {
  type    = bool
  default = false
}
variable "ecs_desired_count" {
  type    = number
  default = 0
}
variable "api_container_image" {
  type    = string
  default = ""
}
variable "rds_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "rds_master_username" {
  type    = string
  default = "smartwarehouse"
}
variable "rds_master_password" {
  type      = string
  sensitive = true
  default   = ""
}
