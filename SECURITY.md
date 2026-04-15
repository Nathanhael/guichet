# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Guichet, please report it responsibly. **Do not open a public GitHub issue.**

### How to Report

Email your findings to: **security@guichet.dev**

Please include:
- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: Within 48 hours of your report
- **Assessment**: We will evaluate the severity and impact within 7 days
- **Resolution**: Critical vulnerabilities will be patched as soon as possible, typically within 30 days
- **Disclosure**: We will coordinate public disclosure with you after a fix is released

### Scope

The following are in scope:
- Authentication and authorization bypasses
- SQL injection, XSS, CSRF vulnerabilities
- Data exposure or leakage between tenants
- Socket.io security issues
- JWT token vulnerabilities
- Docker container escape or privilege escalation

The following are **out of scope**:
- Vulnerabilities in third-party dependencies (report these upstream)
- Issues requiring physical access to the server
- Social engineering attacks
- Denial of service attacks against development/demo instances

### Recognition

We appreciate security researchers who help keep Guichet safe. With your permission, we will acknowledge your contribution in our release notes.

## Security Best Practices for Deployment

- **Never** use the default development credentials in production
- Always set a strong, unique `JWT_SECRET` in your `.env` file
- Use `docker-compose.prod.yml` for production deployments
- Enable TLS/HTTPS via a reverse proxy (e.g., Nginx, Traefik, Caddy)
- Regularly update dependencies and Docker base images
- Review the [production setup guide](README.md#first-time-production-setup) before deploying
