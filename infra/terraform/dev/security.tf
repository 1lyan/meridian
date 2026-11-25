resource "aws_security_group" "instance" {
  name        = "meridian-instance"
  description = "HTTP from the internet. No SSH. SSM is the way in."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "database" {
  name        = "meridian-database"
  description = "Postgres from the instance only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from the instance"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.instance.id]
  }
}
