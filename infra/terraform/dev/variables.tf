variable "region" {
  type    = string
  default = "us-east-1"
}

variable "mongo_url" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Atlas M0 connection string. Empty until the Elastic IP is allowlisted."
}

variable "enable_nat" {
  type        = bool
  default     = false
  description = "Must stay false. A NAT gateway spends Free-plan credits while idle."

  validation {
    condition     = var.enable_nat == false
    error_message = "NAT gateways are refused. See ADR 0008."
  }
}
