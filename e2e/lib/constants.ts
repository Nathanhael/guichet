export const API_URL = process.env.API_URL || 'http://server:3001';
export const APP_URL = process.env.APP_URL || 'http://client:5173';

export const TEST_PARTNER_A = {
  id: 'test-partner-a',
  name: 'Test Partner A',
  industry: 'Technology',
};

export const TEST_PARTNER_B = {
  id: 'test-partner-b',
  name: 'Test Partner B',
  industry: 'Technology',
};

export const TEST_USERS = {
  agentA: { id: 'e2e-agent-a', password: 'TestPass123!', role: 'agent', partnerId: TEST_PARTNER_A.id },
  supportA: { id: 'e2e-support-a', password: 'TestPass123!', role: 'support', partnerId: TEST_PARTNER_A.id },
  adminA: { id: 'e2e-admin-a', password: 'TestPass123!', role: 'admin', partnerId: TEST_PARTNER_A.id },
  supportB: { id: 'e2e-support-b', password: 'TestPass123!', role: 'support', partnerId: TEST_PARTNER_B.id },
};
