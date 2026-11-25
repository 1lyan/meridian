resource "aws_budgets_budget" "monthly" {
  for_each = toset(["20", "50"])

  name         = "meridian-monthly-${each.key}"
  budget_type  = "COST"
  limit_amount = each.key
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}
