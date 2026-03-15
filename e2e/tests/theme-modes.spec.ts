import { test, expect } from '@playwright/test';
import { loginInContext } from '../lib/login.js';

const MODE_COMBINATIONS = [
  { dark: false, dyslexic: false, highContrast: false, name: 'light' },
  { dark: true,  dyslexic: false, highContrast: false, name: 'dark' },
  { dark: false, dyslexic: true,  highContrast: false, name: 'dyslexic' },
  { dark: true,  dyslexic: true,  highContrast: false, name: 'dark-dyslexic' },
  { dark: false, dyslexic: false, highContrast: true,  name: 'high-contrast' },
  { dark: true,  dyslexic: false, highContrast: true,  name: 'dark-high-contrast' },
  { dark: false, dyslexic: true,  highContrast: true,  name: 'dyslexic-high-contrast' },
  { dark: true,  dyslexic: true,  highContrast: true,  name: 'dark-dyslexic-high-contrast' },
];

test.describe('Theme Mode Combinations', () => {
  for (const mode of MODE_COMBINATIONS) {
    test(`renders correctly: ${mode.name}`, async ({ browser }) => {
      const context = await browser.newContext();

      // Collect console errors from the start
      const errors: string[] = [];

      // Login as support user (richest UI)
      const page = await loginInContext(context, 'supportA');

      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });

      // Set theme modes via localStorage
      await page.evaluate((m) => {
        localStorage.setItem('darkMode', JSON.stringify(m.dark));
        localStorage.setItem('dyslexicMode', JSON.stringify(m.dyslexic));
        localStorage.setItem('highContrastMode', JSON.stringify(m.highContrast));
      }, mode);

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(500);

      // Verify CSS classes on <html>
      const html = page.locator('html');
      if (mode.dark) {
        await expect(html).toHaveClass(/dark/);
      }
      if (mode.dyslexic) {
        await expect(html).toHaveClass(/dyslexic-mode/);
      }
      if (mode.highContrast) {
        await expect(html).toHaveClass(/high-contrast-mode/);
      }

      // Capture screenshot for visual regression review
      await page.screenshot({
        path: `e2e/test-results/theme-${mode.name}.png`,
        fullPage: true,
      });

      // Assert no console errors occurred
      expect(errors).toHaveLength(0);

      await context.close();
    });
  }
});
