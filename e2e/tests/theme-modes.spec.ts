import { test, expect } from '@playwright/test';
import { loginInContext } from '../lib/login';
import { SUPPORT_USER } from '../lib/constants';

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
      const page = await context.newPage();
      await loginInContext(page, SUPPORT_USER);

      // Set modes via localStorage and page evaluate
      await page.evaluate((m) => {
        localStorage.setItem('darkMode', JSON.stringify(m.dark));
        localStorage.setItem('dyslexicMode', JSON.stringify(m.dyslexic));
        localStorage.setItem('highContrastMode', JSON.stringify(m.highContrast));
        window.location.reload();
      }, mode);

      // Wait for apply
      await page.waitForTimeout(1000);

      // Verify correct CSS classes on <html>
      const html = page.locator('html');
      if (mode.dark) await expect(html).toHaveClass(/dark/);
      if (mode.dyslexic) await expect(html).toHaveClass(/dyslexic-mode/);
      if (mode.highContrast) await expect(html).toHaveClass(/high-contrast-mode/);

      // No console errors
      const errors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
      });

      // Simple visual check for backgrounds
      const body = page.locator('body');
      const bgColor = await body.evaluate((el) => window.getComputedStyle(el).backgroundColor);
      
      if (mode.highContrast) {
        if (mode.dark) expect(bgColor).toBe('rgb(0, 0, 0)');
        else expect(bgColor).toBe('rgb(255, 255, 255)');
      } else if (mode.dyslexic) {
        if (!mode.dark) expect(bgColor).toBe('rgb(255, 251, 235)'); // #FFFBEB
      }

      expect(errors).toHaveLength(0);
      await context.close();
    });
  }
});
