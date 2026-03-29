import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('switch-partner step-up freshness (#10)', () => {
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/auth.ts'), 'utf-8'
  );

  it('checks isPlatformStepUpSatisfied during switch-partner', () => {
    const switchBlock = authSource.slice(
      authSource.indexOf("'/switch-partner'"),
      authSource.indexOf("'/logout'")
    );
    expect(switchBlock).toMatch(/isPlatformStepUpSatisfied/);
  });

  it('clears platformStepUpAt if step-up expired', () => {
    const switchBlock = authSource.slice(
      authSource.indexOf("'/switch-partner'"),
      authSource.indexOf("'/logout'")
    );
    expect(switchBlock).toMatch(/platformStepUpAt.*undefined|platformStepUpAt.*:.*isPlatformStepUpSatisfied/);
  });
});
