export const mockUsers = {
  agent: { id: 'mock-agent', username: 'agent', name: 'Mock Agent', role: 'agent', lang: 'en' },
  support: { id: 'mock-support', username: 'support', name: 'Mock Support', role: 'support', lang: 'en' },
  admin: { id: 'mock-admin', username: 'admin', name: 'Mock Admin', role: 'admin', lang: 'en' },
};

export const mockPartner = {
  id: 'mock-partner',
  name: 'Mock Partner',
  industry: 'Technology',
  departments: [
    { id: 'DSC', label: 'Dispatch' },
    { id: 'FOT', label: 'Field Ops' },
  ],
};

export const mockTickets = [
  {
    id: 'mock-ticket-1',
    status: 'open',
    dept: 'DSC',
    ref1: 'REF-001',
    ref2: '',
    participants: ['mock-agent'],
    partner_id: 'mock-partner',
    created_at: new Date().toISOString(),
  },
];

export const mockMessages = [
  {
    id: 'mock-msg-1',
    ticketId: 'mock-ticket-1',
    senderId: 'mock-agent',
    senderName: 'Mock Agent',
    senderRole: 'agent',
    originalText: 'Hello, I need help',
    improvedText: 'Hello, I need assistance with an issue.',
    processedText: 'Hello, I need assistance with an issue.',
    translationSkipped: true,
    fallback: false,
    whisper: false,
    system: false,
    reactions: '{}',
    created_at: new Date().toISOString(),
  },
];

export const mockConfig = {
  partnerId: 'mock-partner',
  partnerName: 'Mock Partner',
  industry: 'Technology',
  departments: mockPartner.departments,
  ref1Label: 'Reference',
  ref2Label: 'Case ID',
  businessHours: { start: '07:30', end: '22:30', timezone: 'Europe/Brussels' },
  ai_enabled: true,
};

export const mockMemberships: Record<string, Array<{ id: string; userId: string; partnerId: string; role: string }>> = {
  'mock-agent': [{ id: 'mem-agent', userId: 'mock-agent', partnerId: 'mock-partner', role: 'agent' }],
  'mock-support': [{ id: 'mem-support', userId: 'mock-support', partnerId: 'mock-partner', role: 'support' }],
  'mock-admin': [{ id: 'mem-admin', userId: 'mock-admin', partnerId: 'mock-partner', role: 'admin' }],
};
