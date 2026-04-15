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

## Accepted Dependency Risks

The following `npm audit` findings are acknowledged and intentionally unfixed. They are re-evaluated whenever the affected dependency releases a new major version.

### `drizzle-kit` → `@esbuild-kit/esm-loader` → bundled `esbuild` (moderate)

- **Advisory**: [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — esbuild allows any website to send requests to the dev server and read the response (CVSS 5.3).
- **Path**: `drizzle-kit@0.31.10` → `@esbuild-kit/esm-loader@^2.5.5` → `@esbuild-kit/core-utils` → `esbuild <=0.24.2`. Also surfaces as 4 moderate findings (one per hop) in `npm audit`.
- **Why unfixed**: `@esbuild-kit/*` is deprecated and no longer receives updates. The latest stable `drizzle-kit` (0.31.10, also the version we pin) still depends on it. The only available `npm audit fix --force` target is `drizzle-kit@0.18.1`, which is a downgrade and would break our schema/migration workflow.
- **Why the risk is acceptable here**: The vulnerability requires running esbuild's dev server. `drizzle-kit` is a CLI used solely for generating and applying migrations (`drizzle-kit generate`, `drizzle-kit migrate`, `drizzle-kit studio`). It never spawns the esbuild dev server in any Guichet code path — the bundled `esbuild` is used only for its bundler API. The attack surface therefore does not exist in our usage.
- **Conditions for revisiting**:
  - drizzle-kit drops the `@esbuild-kit/esm-loader` dependency (tracked in their 1.0.0-beta line), or
  - esbuild-kit publishes a patched release, or
  - A proof-of-concept demonstrates exploitability through the drizzle-kit code paths we actually invoke.

