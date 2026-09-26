variable "bucket_name" {
  type    = string
  default = ""
}
variable "expiration_days" {
  type    = number
  default = 6
}
resource "aws_s3_bucket" "documents" {
  bucket        = var.bucket_name != "" ? var.bucket_name : null
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    id     = "expire-temporary-documents"
    status = "Enabled"
    expiration {
      days = var.expiration_days
    }
  }
}
output "bucket_name" { value = aws_s3_bucket.documents.bucket }
