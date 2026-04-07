import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';
const DEMO_PASSWORD = 'password123';

/** Login helper using browser fetch so cookies land in the browser's cookie jar */
async function loginAsDemo(page: Page, userId: string) {
  await page.goto(BASE);
  await page.waitForLoadState('load');

  const data = await page.evaluate(async ({ uid, pw }) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: uid, password: pw }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json();
    return { ok: true, ...json };
  }, { uid: userId, pw: DEMO_PASSWORD });

  if (!data.ok) return data;

  await page.evaluate(({ user, memberships }) => {
    sessionStorage.setItem('user', JSON.stringify(user));
    sessionStorage.setItem('memberships', JSON.stringify(memberships));
    if (memberships?.length > 0) {
      sessionStorage.setItem('activeMembershipId', memberships[0].id);
      sessionStorage.setItem('activePartnerId', memberships[0].partnerId);
    }
  }, data);

  await page.reload();
  await page.waitForLoadState('networkidle');
  return data;
}

/** Open the first available ticket in the sidebar (support view) */
async function openFirstTicket(page: Page) {
  const ticket = page.locator('aside li, aside button.flex-col').first();
  await ticket.waitFor({ state: 'visible', timeout: 15000 });
  await ticket.click();
  // Wait for the chat window to load (textarea becomes visible)
  await page.locator('textarea[aria-label="Type a message"]').waitFor({ state: 'visible', timeout: 10000 });
}

test.describe('Chat Enhancements', () => {
  test.setTimeout(60000);

  test('delivery checkmarks visible on sent messages', async ({ page }) => {
    await loginAsDemo(page, 'support_sarah');
    await openFirstTicket(page);

    // Send a test message
    const textarea = page.locator('textarea[aria-label="Type a message"]');
    await textarea.fill('Checkmark test message ' + Date.now());
    await textarea.press('Enter');

    // Wait for message to appear
    await page.waitForTimeout(1500);

    // The DeliveryStatus component renders an SVG with polyline checkmarks for own messages.
    const lastSentBubble = page.locator('.bubble-sent').last();
    await expect(lastSentBubble).toBeVisible();

    // The delivery status renders inside a span[aria-label] containing an SVG with polyline elements
    const deliveryStatusSvg = lastSentBubble.locator('span[aria-label] svg polyline');
    await expect(deliveryStatusSvg.first()).toBeVisible({ timeout: 5000 });
  });

  test('markdown renders in messages', async ({ page }) => {
    await loginAsDemo(page, 'support_sarah');
    await openFirstTicket(page);

    // Send a message with markdown bold syntax
    const textarea = page.locator('textarea[aria-label="Type a message"]');
    await textarea.fill('Testing **bold text** rendering');
    await textarea.press('Enter');

    // Wait for message to render
    await page.waitForTimeout(1500);

    // The MessageContent component renders markdown in a .msg-markdown div.
    // **bold text** should become <strong>bold text</strong>
    const strongEl = page.locator('.msg-markdown strong').filter({ hasText: 'bold text' });
    await expect(strongEl.last()).toBeVisible({ timeout: 5000 });
  });

  test('reply to a message', async ({ page }) => {
    await loginAsDemo(page, 'support_sarah');
    await openFirstTicket(page);

    // Wait for messages to load
    await page.waitForTimeout(1500);

    // Find a non-system message bubble to reply to
    const messageBubble = page.locator('[id^="msg-"]').first();
    await expect(messageBubble).toBeVisible();

    // Hover on the message to show action buttons
    await messageBubble.hover();

    // Click the reply button (CornerUpLeft icon, title="Reply" or localized variant)
    const replyBtn = messageBubble.locator('button[title="Reply"], button[title="Antwoord"], button[title="Repondre"]');
    const count = await replyBtn.count();
    if (count > 0) {
      await replyBtn.first().click();
    } else {
      // Fallback: find button containing the CornerUpLeft SVG
      const svgBtn = messageBubble.locator('button').filter({ has: page.locator('svg.lucide-corner-up-left') });
      await svgBtn.first().click();
    }

    // Verify reply banner appears above textarea with "Replying to" text
    const replyBanner = page.locator('.border-accent-blue').filter({ hasText: /Replying to|Antwoord aan|Repondre/ });
    await expect(replyBanner.first()).toBeVisible({ timeout: 3000 });

    // Type and send a reply
    const textarea = page.locator('textarea[aria-label="Type a message"]');
    await textarea.fill('This is a reply message ' + Date.now());
    await textarea.press('Enter');

    // Wait for message to be sent
    await page.waitForTimeout(2000);

    // Verify the sent message contains a QuoteBlock (border-l-[3px] border-accent-blue element)
    const lastSentBubble = page.locator('.bubble-sent').last();
    const quoteBlock = lastSentBubble.locator('.border-accent-blue');
    await expect(quoteBlock).toBeVisible({ timeout: 5000 });
  });

  test('jump-to-bottom FAB', async ({ page }) => {
    await loginAsDemo(page, 'support_sarah');
    await openFirstTicket(page);

    // Wait for messages to load
    await page.waitForTimeout(2000);

    // Find the scrollable message container
    const scrollContainer = page.locator('.overflow-y-auto.scrollbar-thin').first();
    await expect(scrollContainer).toBeVisible();

    // Scroll up to top to trigger the FAB
    await scrollContainer.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(300);

    // Dispatch scroll event to trigger the handler
    await scrollContainer.evaluate((el) => {
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    // The FAB button has aria-label "Scroll to bottom" and contains an ArrowDown icon
    const fab = page.locator('button[aria-label="Scroll to bottom"], button[aria-label*="scroll"]');
    await expect(fab.first()).toBeVisible({ timeout: 3000 });

    // Click the FAB
    await fab.first().click();
    await page.waitForTimeout(500);

    // FAB should disappear after scrolling to bottom
    await expect(fab.first()).toBeHidden({ timeout: 3000 });
  });

  test('label picker opens and shows labels', async ({ page }) => {
    await loginAsDemo(page, 'support_sarah');
    await openFirstTicket(page);

    // Find the "+" label button in the header (aria-label "Add label")
    const addLabelBtn = page.locator('button[aria-label="Add label"]');
    await expect(addLabelBtn).toBeVisible({ timeout: 5000 });

    // Click to open the dropdown
    await addLabelBtn.click();

    // The LabelPicker dropdown has min-w-[180px] class
    const dropdown = page.locator('.min-w-\\[180px\\]');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Verify it contains at least one label item (button with a colored dot and text)
    const labelItems = dropdown.locator('button');
    const labelCount = await labelItems.count();
    expect(labelCount).toBeGreaterThan(0);

    // Each label has a name displayed in a font-mono span
    const firstLabelName = labelItems.first().locator('.font-mono');
    await expect(firstLabelName).toBeVisible();
  });

  test('date separator renders', async ({ page }) => {
    await loginAsDemo(page, 'support_sarah');
    await openFirstTicket(page);

    // Wait for messages to load
    await page.waitForTimeout(2000);

    // Date separators are centered labels with uppercase tracking-widest font-mono text
    // containing day references like "Today", "Yesterday", or abbreviated day/month names.
    const dateSeparator = page.locator('span.uppercase.tracking-widest').filter({
      hasText: /Today|Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i,
    });

    // At least one date separator should be visible (first message always gets one)
    await expect(dateSeparator.first()).toBeVisible({ timeout: 5000 });
  });

  test('multi-file upload input accepts multiple', async ({ page }) => {
    await loginAsDemo(page, 'support_sarah');
    await openFirstTicket(page);

    // Find the hidden file input element used by the attach button
    const fileInput = page.locator('input[type="file"][aria-label="Attach files"]');

    // Verify it has the `multiple` attribute (Track E: multi-file upload)
    await expect(fileInput).toHaveAttribute('multiple', '');

    // Also verify it accepts the expected file types
    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('image/*');
    expect(accept).toContain('.pdf');
  });
});
