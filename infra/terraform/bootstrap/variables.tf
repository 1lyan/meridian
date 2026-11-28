variable "region" {
  type    = string
  default = "us-east-1"
}

variable "github_repository" {
  type        = string
  description = "GitHub repository allowed to assume the apply role. owner/name."
  default     = "1lyan/meridian"
}

variable "github_oidc_subject" {
  type        = string
  description = "GitHub Actions OIDC subject for this repo, without the ref suffix. GitHub includes the immutable owner id and repository id."
  default     = "1lyan@807091/meridian@1461829565"
}

variable "budget_email" {
  type        = string
  description = "Inbox for the $20 and $50 monthly spend alerts."

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_email))
    error_message = "budget_email must be an email address."
  }
}
