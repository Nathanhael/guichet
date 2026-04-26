import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectQueue: unknown[] = [];
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();

const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectQueue.shift()),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      updateSetMock(values);
      return { where: updateWhereMock };
    }),
  })),
};

vi.mock('../db/postgres.js', () => ({
  db: dbMock,
}));

vi.mock('../db/schema.js', () => ({
  partners: { id: 'partners.id', departments: 'partners.departments' },
  tickets: { id: 'tickets.id' },
}));

describe('findPartnerDepartments', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    dbMock.select.mockClear();
    dbMock.update.mockClear();
    updateSetMock.mockReset();
    updateWhereMock.mockReset();
    updateWhereMock.mockResolvedValue(undefined);
  });

  it('returns departments array for a valid partner', async () => {
    const departments = [
      { id: 'sales', name: 'Sales', description: 'Sales team' },
      { id: 'support', name: 'Support' },
    ];
    selectQueue.push([{ departments }]);

    const { findPartnerDepartments } = await import('./transferService.js');
    const result = await findPartnerDepartments('partner-1');

    expect(result).toEqual(departments);
    expect(dbMock.select).toHaveBeenCalled();
  });

  it('returns empty array when partner is not found', async () => {
    selectQueue.push([]);

    const { findPartnerDepartments } = await import('./transferService.js');
    const result = await findPartnerDepartments('nonexistent-partner');

    expect(result).toEqual([]);
  });

  it('returns empty array when departments is null', async () => {
    selectQueue.push([{ departments: null }]);

    const { findPartnerDepartments } = await import('./transferService.js');
    const result = await findPartnerDepartments('partner-no-depts');

    expect(result).toEqual([]);
  });

  it('returns empty array when departments is undefined', async () => {
    selectQueue.push([{ departments: undefined }]);

    const { findPartnerDepartments } = await import('./transferService.js');
    const result = await findPartnerDepartments('partner-undef-depts');

    expect(result).toEqual([]);
  });

  it('returns empty array when departments is an empty array', async () => {
    selectQueue.push([{ departments: [] }]);

    const { findPartnerDepartments } = await import('./transferService.js');
    const result = await findPartnerDepartments('partner-empty-depts');

    expect(result).toEqual([]);
  });

  it('handles single department', async () => {
    const departments = [{ id: 'billing', name: 'Billing' }];
    selectQueue.push([{ departments }]);

    const { findPartnerDepartments } = await import('./transferService.js');
    const result = await findPartnerDepartments('partner-single');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'billing', name: 'Billing' });
  });
});

describe('transferTicketToDepartment', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    dbMock.select.mockClear();
    dbMock.update.mockClear();
    updateSetMock.mockReset();
    updateWhereMock.mockReset();
    updateWhereMock.mockResolvedValue(undefined);
  });

  it('updates ticket with new department and clears support assignment', async () => {
    const { transferTicketToDepartment } = await import('./transferService.js');
    await transferTicketToDepartment('ticket-1', 'billing');

    expect(dbMock.update).toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith({
      dept: 'billing',
      supportId: null,
      supportName: null,
      status: 'open',
      queueEnteredAt: expect.any(String),
    });
    expect(updateWhereMock).toHaveBeenCalled();
  });

  it('bumps queueEnteredAt to NOW so the transferred ticket joins the new dept queue at the back', async () => {
    const before = new Date().toISOString();
    const { transferTicketToDepartment } = await import('./transferService.js');
    await transferTicketToDepartment('ticket-bump', 'billing');
    const after = new Date().toISOString();

    const call = updateSetMock.mock.calls[0]?.[0] as { queueEnteredAt?: string };
    expect(call?.queueEnteredAt).toBeDefined();
    // Stamped between the start and end of the call — proves it's NOW(),
    // not the original createdAt or some null-default fallback.
    expect(call.queueEnteredAt! >= before).toBe(true);
    expect(call.queueEnteredAt! <= after).toBe(true);
  });

  it('sets status to open on transfer', async () => {
    const { transferTicketToDepartment } = await import('./transferService.js');
    await transferTicketToDepartment('ticket-2', 'sales');

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open' }),
    );
  });

  it('nullifies supportId and supportName on transfer', async () => {
    const { transferTicketToDepartment } = await import('./transferService.js');
    await transferTicketToDepartment('ticket-3', 'support');

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supportId: null,
        supportName: null,
      }),
    );
  });

  it('sets the correct department id', async () => {
    const { transferTicketToDepartment } = await import('./transferService.js');
    await transferTicketToDepartment('ticket-4', 'engineering');

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ dept: 'engineering' }),
    );
  });

  it('resolves without error for valid input', async () => {
    const { transferTicketToDepartment } = await import('./transferService.js');

    await expect(
      transferTicketToDepartment('ticket-5', 'hr'),
    ).resolves.toBeUndefined();
  });

  it('propagates database errors', async () => {
    updateWhereMock.mockRejectedValueOnce(new Error('DB connection lost'));

    const { transferTicketToDepartment } = await import('./transferService.js');

    await expect(
      transferTicketToDepartment('ticket-err', 'sales'),
    ).rejects.toThrow('DB connection lost');
  });
});
