export type UserRole = 'agent' | 'support' | 'admin' | 'platform_operator';

export type Capability =
  | 'tenant_admin'
  | 'platform_admin'
  | 'support_like'
  | 'use_support_workflows'
  | 'manage_tenant'
  | 'export_tickets'
  | 'destructive_admin';
