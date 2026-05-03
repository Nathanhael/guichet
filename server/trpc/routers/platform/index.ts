import { router } from '../../trpc.js';
import { platformPartnersRouter } from './partners.js';
import { platformUsersRouter } from './users.js';
import { platformAuditRouter } from './audit.js';
import { platformSsoRouter } from './sso.js';
import { platformSystemRouter } from './system.js';
import { platformSecurityRouter } from './security.js';

export const platformRouter = router({
  ...platformPartnersRouter._def.procedures,
  ...platformUsersRouter._def.procedures,
  ...platformAuditRouter._def.procedures,
  ...platformSsoRouter._def.procedures,
  ...platformSystemRouter._def.procedures,
  ...platformSecurityRouter._def.procedures,
});
