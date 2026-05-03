import { describe, it, expect } from 'vitest';
import { redactPii, unredactPii } from './piiRedaction';

describe('redactPii — email', () => {
  it('redacts a single email', () => {
    const r = redactPii('contact me at jane.doe@example.com please');
    expect(r.redacted).toBe('contact me at [EMAIL_1] please');
    expect(r.tokens).toEqual({ '[EMAIL_1]': 'jane.doe@example.com' });
  });

  it('increments tokens for distinct emails', () => {
    const r = redactPii('a@x.com and b@y.com');
    expect(r.redacted).toBe('[EMAIL_1] and [EMAIL_2]');
    expect(r.tokens).toEqual({
      '[EMAIL_1]': 'a@x.com',
      '[EMAIL_2]': 'b@y.com',
    });
  });

  it('dedupes identical emails to the same token', () => {
    const r = redactPii('mail a@b.com or a@b.com');
    expect(r.redacted).toBe('mail [EMAIL_1] or [EMAIL_1]');
    expect(Object.keys(r.tokens)).toHaveLength(1);
  });

  it('handles plus-addressing and dotted local parts', () => {
    const r = redactPii('use first.last+tag@sub.domain.co.uk for that');
    expect(r.redacted).toBe('use [EMAIL_1] for that');
    expect(r.tokens['[EMAIL_1]']).toBe('first.last+tag@sub.domain.co.uk');
  });

  it('does not match strings without @', () => {
    const r = redactPii('just text and example.com here');
    expect(r.redacted).toBe('just text and example.com here');
    expect(r.tokens).toEqual({});
  });

  it('does not match a bare @ with no local or domain', () => {
    const r = redactPii('symbol @ alone, and @host without local');
    expect(r.tokens).toEqual({});
  });
});

describe('redactPii — BE phone', () => {
  it('redacts +32 mobile with spaces', () => {
    const r = redactPii('call +32 470 12 34 56 today');
    expect(r.redacted).toBe('call [PHONE_1] today');
    expect(r.tokens['[PHONE_1]']).toBe('+32 470 12 34 56');
  });

  it('redacts 0-prefixed national format', () => {
    const r = redactPii('reach 0470 12 34 56 anytime');
    expect(r.redacted).toBe('reach [PHONE_1] anytime');
    expect(r.tokens['[PHONE_1]']).toBe('0470 12 34 56');
  });

  it('redacts compact +32 with no spaces', () => {
    const r = redactPii('also +32470123456 works');
    expect(r.redacted).toBe('also [PHONE_1] works');
  });

  it('dedupes the same phone literal', () => {
    const r = redactPii('+32 470 12 34 56 and +32 470 12 34 56 again');
    expect(r.redacted).toBe('[PHONE_1] and [PHONE_1] again');
    expect(Object.keys(r.tokens)).toHaveLength(1);
  });

  it('does not match a US phone like +1 555 123 4567', () => {
    const r = redactPii('US line +1 555 123 4567 here');
    expect(r.tokens).toEqual({});
  });
});

describe('redactPii — NRN (rijksregisternummer)', () => {
  it('redacts dotted-and-hyphenated NRN format', () => {
    const r = redactPii('NRN 85.07.30-033.61 on file');
    expect(r.redacted).toBe('NRN [NRN_1] on file');
    expect(r.tokens['[NRN_1]']).toBe('85.07.30-033.61');
  });

  it('redacts unformatted 11-digit NRN', () => {
    const r = redactPii('id 85073003361 raw');
    expect(r.redacted).toBe('id [NRN_1] raw');
    expect(r.tokens['[NRN_1]']).toBe('85073003361');
  });

  it('does not match a 10-digit number', () => {
    const r = redactPii('short 1234567890 number');
    expect(r.tokens).toEqual({});
  });
});

describe('redactPii — credit card (Luhn-validated)', () => {
  it('redacts a Luhn-valid hyphenated 16-digit card', () => {
    const r = redactPii('card 4111-1111-1111-1111 expires soon');
    expect(r.redacted).toBe('card [CC_1] expires soon');
    expect(r.tokens['[CC_1]']).toBe('4111-1111-1111-1111');
  });

  it('redacts a Luhn-valid space-separated card', () => {
    const r = redactPii('Visa 4111 1111 1111 1111 ok');
    expect(r.redacted).toBe('Visa [CC_1] ok');
  });

  it('redacts an unformatted 16-digit Luhn-valid card', () => {
    const r = redactPii('raw 4111111111111111 here');
    expect(r.redacted).toBe('raw [CC_1] here');
  });

  it('redacts a 13-digit Luhn-valid card (4222222222222)', () => {
    const r = redactPii('legacy 4222222222222 number');
    expect(r.redacted).toBe('legacy [CC_1] number');
  });

  it('does NOT redact an invalid Luhn 16-digit string', () => {
    const r = redactPii('fake 1234-5678-9012-3456 number');
    expect(r.redacted).toBe('fake 1234-5678-9012-3456 number');
    expect(r.tokens).toEqual({});
  });

  it('does NOT redact a 12-digit number (too short)', () => {
    const r = redactPii('short 123456789012 here');
    expect(r.tokens).toEqual({});
  });

  it('does NOT redact a 20-digit number (too long)', () => {
    const r = redactPii('long 12345678901234567890 here');
    expect(r.tokens).toEqual({});
  });
});

describe('redactPii — priority and pattern interaction', () => {
  it('redacts email before any digit-pattern can touch its local part', () => {
    const r = redactPii('contact 123@example.com about it');
    expect(r.redacted).toBe('contact [EMAIL_1] about it');
  });

  it('handles all four PII types in one input', () => {
    const input =
      'mail a@b.com phone +32 470 12 34 56 nrn 85.07.30-033.61 card 4111-1111-1111-1111';
    const r = redactPii(input);
    expect(r.redacted).toBe(
      'mail [EMAIL_1] phone [PHONE_1] nrn [NRN_1] card [CC_1]',
    );
    expect(r.tokens).toEqual({
      '[EMAIL_1]': 'a@b.com',
      '[PHONE_1]': '+32 470 12 34 56',
      '[NRN_1]': '85.07.30-033.61',
      '[CC_1]': '4111-1111-1111-1111',
    });
  });
});

describe('unredactPii', () => {
  it('replaces tokens back to original values', () => {
    const r = redactPii('mail a@b.com again');
    expect(unredactPii(r.redacted, r.tokens)).toBe('mail a@b.com again');
  });

  it('roundtrips a mixed-PII input exactly', () => {
    const input =
      'jane.doe@example.com called from +32 470 12 34 56, NRN 85.07.30-033.61, card 4111-1111-1111-1111.';
    const r = redactPii(input);
    expect(unredactPii(r.redacted, r.tokens)).toBe(input);
  });

  it('leaves unknown tokens unchanged when the map is empty', () => {
    expect(unredactPii('text [EMAIL_99] tail', {})).toBe('text [EMAIL_99] tail');
  });

  it('leaves non-token bracketed text unchanged', () => {
    expect(unredactPii('see [TODO] later', {})).toBe('see [TODO] later');
  });
});

describe('redactPii — edge cases', () => {
  it('returns empty redacted + empty tokens for empty input', () => {
    const r = redactPii('');
    expect(r.redacted).toBe('');
    expect(r.tokens).toEqual({});
  });

  it('returns the input unchanged when no PII is present', () => {
    const r = redactPii('plain prose with no secrets');
    expect(r.redacted).toBe('plain prose with no secrets');
    expect(r.tokens).toEqual({});
  });

  it('per-call counters are independent across invocations', () => {
    const a = redactPii('one a@x.com');
    const b = redactPii('two b@y.com');
    expect(a.tokens).toEqual({ '[EMAIL_1]': 'a@x.com' });
    expect(b.tokens).toEqual({ '[EMAIL_1]': 'b@y.com' });
  });
});
