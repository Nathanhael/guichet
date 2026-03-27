# Workflow: Tessera

## Deployment Lifecycle
**Research -> Strategy -> Execution**

## Execution Cycle
**Plan -> Act -> Validate**

## Critical Mandates
- **DOCKER ONLY**: Never run npm/node commands on the host machine.
- **BRUTALIST TOKENS**: Use CSS custom property design tokens. No inline colors or gradients.
- **MINIMAL MOTION**: Only a 150ms fade-in is allowed.
- **TYPE SAFETY**: 100% tRPC and Drizzle coverage. No `any` types.
- **MULTI-TENANCY**: Every query must filter by `partner_id`.
- **AUDIT LOGGING**: Log all security-relevant actions.
