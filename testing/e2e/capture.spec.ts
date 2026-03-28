import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });

test('capture platform admin screenshot', async ({ page }) => {
  await page.goto('/login');
  await page.waitForTimeout(1000);
  
  // Click Demo Mode
  await page.locator('button', { hasText: /Demo|Modus|Démo/i }).click();
  await page.waitForTimeout(500);
  
  // Click Bart Operator
  await page.locator('button', { hasText: 'Bart Operator' }).click();
  
  // Wait for the Dashboard or Platform view
  await page.waitForTimeout(3000); // just wait 3 seconds for rendering
  
  const dir = path.resolve('docs', 'screenshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // optionally remove the user security modal trigger if present
  await page.evaluate(() => {
    const btn = document.querySelector('button[title="Account Security"]');
    if (btn) btn.remove();
  });
  
  await page.screenshot({ path: path.join(dir, 'platform-dark.png') });
});

test('capture support view screenshot', async ({ page }) => {
  await page.goto('/login');
  await page.waitForTimeout(1000);
  
  // Click Demo Mode
  await page.locator('button', { hasText: /Demo|Modus|Démo/i }).click();
  await page.waitForTimeout(500);
  
  // Click Alex Johnson
  await page.locator('button', { hasText: 'Alex Johnson' }).click();
  
  // Wait for Support View
  await page.waitForTimeout(3000);
  
  const dir = path.resolve('docs', 'screenshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  await page.evaluate(() => {
    const btn = document.querySelector('button[title="Account Security"]');
    if (btn) btn.remove();
  });
  
  await page.screenshot({ path: path.join(dir, 'support-dark.png') });
});
