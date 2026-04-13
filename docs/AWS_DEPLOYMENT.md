# AWS Deployment Guide

Pre-deployment checklist and configuration for running Tessera on AWS Free Tier.

## Architecture (Free Tier)

| Component | AWS Service | Free Tier Limit |
|-----------|------------|-----------------|
| Server container | ECS Fargate or App Runner | 750h/mo (t2.micro equivalent) |
| Client (static) | S3 + CloudFront | 5GB storage, 1M requests |
| PostgreSQL | RDS PostgreSQL | 750h/mo db.t3.micro, 20GB |
| Redis | ElastiCache Redis | 750h/mo cache.t3.micro |
| File uploads | S3 | 5GB, 20K GET, 2K PUT |
| Container images | ECR | 500MB |
| SSL certs | ACM | Free |
| Load balancer | ALB | 750h/mo |

## Environment Variables

**Required** (server exits without these in production):

| Variable | Example | Notes |
|----------|---------|-------|
| `NODE_ENV` | `production` | Enables production hardening |
| `JWT_SECRET` | 64+ char random string | HS256 signing key |
| `DATABASE_URL` | `postgresql://user:pass@rds-host:5432/tessera?sslmode=require` | RDS connection string |
| `REDIS_URL` | `rediss://:auth-token@elasticache-host:6379` | **Must use `rediss://` (TLS)** for ElastiCache |
| `CORS_ORIGIN` | `https://tessera.example.com` | Must not contain `localhost` |
| `FRONTEND_URL` | `https://tessera.example.com` | Must not contain `localhost` |
| `COOKIE_SECURE` | `true` | Mandatory in production |
| `COOKIE_DOMAIN` | `.example.com` | Set if using subdomains |
| `PLATFORM_ADMIN_EMAIL` | `admin@example.com` | Auto-creates platform operator on first boot |

**AWS S3 Storage** (omit for local disk fallback):

| Variable | Example | Notes |
|----------|---------|-------|
| `AWS_S3_BUCKET` | `tessera-uploads` | Presence enables S3 backend |
| `AWS_REGION` | `eu-west-1` | Default: eu-west-1 |
| `AWS_ACCESS_KEY_ID` | `AKIA...` | Optional — omit if using IAM roles (ECS task role) |
| `AWS_SECRET_ACCESS_KEY` | `secret...` | Optional — omit if using IAM roles |

**Recommended**: Use ECS task roles instead of access keys. Attach an IAM policy with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:HeadBucket` permissions on the uploads bucket.

## Provisioning Order

```
1. VPC + Subnets (or use default VPC)
2. RDS PostgreSQL (db.t3.micro, 20GB, public=false)
3. ElastiCache Redis (cache.t3.micro, encryption in-transit=true)
4. S3 Bucket (tessera-uploads, Block All Public Access)
5. ECR Repository (tessera-server)
6. ALB + Target Group (health check: /api/v1/health)
7. ECS Cluster + Task Definition + Service
8. ACM Certificate (for custom domain)
9. Route 53 (DNS → ALB)
```

## WebSocket: Sticky Sessions

Socket.io requires the same client to reach the same instance.

### ALB Configuration
Enable sticky sessions on the target group:
```bash
aws elbv2 modify-target-group-attributes \
  --target-group-arn arn:aws:elasticloadbalancing:... \
  --attributes Key=stickiness.enabled,Value=true \
               Key=stickiness.type,Value=app_cookie \
               Key=stickiness.app_cookie.cookie_name,Value=SERVERID \
               Key=stickiness.app_cookie.duration_seconds,Value=86400
```

With a single ECS task (free tier), sticky sessions are automatic — all traffic goes to one instance.

## Redis TLS

ElastiCache with encryption in-transit uses `rediss://`:

```
REDIS_URL=rediss://:auth-token@your-cluster.cache.amazonaws.com:6379
```

Enable "Encryption in-transit" when creating the ElastiCache cluster. The auth token is set during cluster creation.

## Health Probes

Configure ALB health check:
- Path: `/api/v1/health`
- Port: 3001
- Healthy threshold: 2
- Unhealthy threshold: 3
- Interval: 30s
- Timeout: 5s

Returns `200 { status: "ok", database, redis, storage }` or `503 { status: "degraded" }`.

## File Uploads

When `AWS_S3_BUCKET` is set, uploads go to S3. The bucket is created automatically if it doesn't exist.

- Bucket created as **private** (Block All Public Access)
- All file access goes through the auth-gated `/uploads` proxy
- GDPR purge deletes associated S3 objects
- Global memory guard caps concurrent upload buffering at 100MB

### IAM Policy (for ECS task role)
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:HeadBucket"],
    "Resource": [
      "arn:aws:s3:::tessera-uploads",
      "arn:aws:s3:::tessera-uploads/*"
    ]
  }]
}
```

## Database

RDS PostgreSQL with `?sslmode=require`:

```
DATABASE_URL=postgresql://tessera:password@tessera-db.xxx.rds.amazonaws.com:5432/tessera?sslmode=require
```

Run migrations on first deploy:
```bash
docker compose exec server npm run db:migrate
```

## Container Registry

Push production images to ECR:

```bash
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin 123456789.dkr.ecr.eu-west-1.amazonaws.com
docker compose -f docker-compose.prod.yml build
docker tag tessera-server 123456789.dkr.ecr.eu-west-1.amazonaws.com/tessera-server:latest
docker push 123456789.dkr.ecr.eu-west-1.amazonaws.com/tessera-server:latest
```

## ECS Task Definition (key fields)

```json
{
  "family": "tessera-server",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [{
    "name": "server",
    "image": "123456789.dkr.ecr.eu-west-1.amazonaws.com/tessera-server:latest",
    "portMappings": [{ "containerPort": 3001, "protocol": "tcp" }],
    "healthCheck": {
      "command": ["CMD-SHELL", "curl -f http://localhost:3001/api/v1/health || exit 1"],
      "interval": 30,
      "timeout": 5,
      "retries": 3
    },
    "environment": [
      { "name": "NODE_ENV", "value": "production" }
    ],
    "secrets": [
      { "name": "JWT_SECRET", "valueFrom": "arn:aws:ssm:...:parameter/tessera/jwt-secret" },
      { "name": "DATABASE_URL", "valueFrom": "arn:aws:ssm:...:parameter/tessera/database-url" }
    ]
  }]
}
```

## Monitoring

The server exposes Prometheus metrics at `/metrics` (root path). Options:
- CloudWatch Container Insights (built into ECS)
- Prometheus + Grafana on a separate ECS task
- AWS Managed Grafana with Prometheus data source

Structured JSON logs (Pino) go to stdout → CloudWatch Logs automatically via ECS.

## Cost Estimate (Free Tier)

For the first 12 months with minimal usage:
- **$0/mo** — RDS, ElastiCache, S3, ECR within free tier limits
- **~$15-25/mo** — ALB (not fully free-tier covered), NAT Gateway if using private subnets
- **Tip**: Use a single public subnet + security groups instead of NAT Gateway to stay closer to $0
