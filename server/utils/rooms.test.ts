import { describe, expect, it } from 'vitest';
import { Rooms } from './rooms.js';

describe('Rooms', () => {
  it('generates partner room', () => {
    expect(Rooms.partner('p1')).toBe('partner:p1');
  });

  it('generates partner staff room', () => {
    expect(Rooms.staff('p1')).toBe('partner:p1:staff');
  });

  it('generates ticket room', () => {
    expect(Rooms.ticket('t1')).toBe('ticket:t1');
  });

  it('generates user room', () => {
    expect(Rooms.user('u1')).toBe('user:u1');
  });
});
