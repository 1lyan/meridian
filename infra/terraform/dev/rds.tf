resource "random_password" "database" {
  length  = 24
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "meridian"
  subnet_ids = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}

resource "aws_db_instance" "main" {
  identifier                 = "meridian"
  engine                     = "postgres"
  engine_version             = "16"
  instance_class             = "db.t4g.micro"
  allocated_storage          = 20
  db_name                    = "meridian"
  username                   = "meridian"
  password                   = random_password.database.result
  db_subnet_group_name       = aws_db_subnet_group.main.name
  vpc_security_group_ids     = [aws_security_group.database.id]
  publicly_accessible        = false
  multi_az                   = false
  backup_retention_period    = 1
  skip_final_snapshot        = true
  deletion_protection        = false
  storage_encrypted          = true
  auto_minor_version_upgrade = true
}
