variable "region" {
  type    = string
  default = "us-east-1"
}

variable "github_repository" {
  type        = string
  description = "GitHub repository allowed to assume the apply and nightly roles. owner/name."
  default     = "1lyan/meridian"
}

variable "budget_email" {
  type        = string
  description = "Inbox for the $20 and $50 monthly spend alerts."

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_email))
    error_message = "budget_email must be an email address."
  }
}
