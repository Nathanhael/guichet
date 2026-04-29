import { type Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { loginAsDemo } from './helpers/auth';

/**
 * Open the first available ticket in the support sidebar.
 *
 * Bundle D / RFC #82 simplification: the test creates its own ticket via
 * `ticketFixture.create({ agentId: 'agent_qa' })` in beforeEach, so the queue
 * is guaranteed to have an unassigned (`variant="queue"`) ticket. The legacy
 * "Other Agents" fallback is gone — if the ticket isn't visible, that's a real
 * regression, not a fixture-state predicate.
 */
async function openFirstTicket(page: Page) {
  // QueueTicketRow stamps `data-ticket-row` + `data-ticket-variant` on its `<li>`.
  const ticket = page
    .locator('li[data-ticket-row][data-ticket-variant="queue"], li[data-ticket-row][data-ticket-variant="mine"]')
    .first();
  await expect(ticket).toBeVisible({ timeout: 15_000 });

  // Trigger the QueueTicketRow's onMouseEnter/onFocus prefetch for the lazy
  // ComposeArea chunk *before* we click. `.hover()` dispatches mouseenter
  // which kicks off the dynamic `import()` early — without this, the chunk
  // fetch only starts when the chat window renders, and the 35 s `.ProseMirror`
  // wait below races the 460 KB `vendor-editor` download on cold Docker cache.
  await ticket.hover();
  await page.waitForTimeout(300);
  await ticket.click();

  // SupportView shows a preview first — need to click "Join" to open the chat.
  const joinBtn = page.getByRole('button', { name: /^join$|^accept$|deelnemen|rejoindre/i });
  try {
    await joinBtn.waitFor({ state: 'visible', timeout: 5000 });
    await joinBtn.click();
  } catch {
    // Already joined — ticket opened directly into chat (tab was already open).
  }

  // Wait for the chat window to load (compose editor mounts).
  // ComposeArea is lazy-loaded (vendor-editor chunk ~462 KB) so first mount in
  // a fresh browser context can be slow — give it 35s for cold-cache + Suspense.
  await page.locator('.ProseMirror').first().waitFor({ state: 'visible', timeout: 35000 });
}

test.describe('Chat Enhancements', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page, ticketFixture }) => {
    // Login as support_qa first so the fixture call inherits the auth cookie.
    const login = await loginAsDemo(page, 'support_qa', { waitFor: 'networkidle' });
    if (!login.ok) {
      throw new Error(
        `Fixture user 'support_qa' failed to log in (status ${login.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    const partnerId = await page.evaluate(() => sessionStorage.getItem('activePartnerId'));
    if (!partnerId) throw new Error('loginAsDemo did not seed activePartnerId');

    // Bundle D: stage a fresh ticket from agent_qa so support_qa's queue has a
    // deterministic unassigned row. Auto-cleanup runs in afterEach.
    await ticketFixture.create({ partnerId, agentId: 'agent_qa' });

    // Reload so the queue refetches and picks up the new ticket.
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('delivery checkmarks visible on sent messages', async ({ page }) => {
    await openFirstTicket(page);

    // Send a test message
    const textarea = page.locator('.ProseMirror');
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
    await openFirstTicket(page);

    const textarea = page.locator('.ProseMirror');
    await textarea.click();
    await page.keyboard.type('Testing ');
    await page.keyboard.type('**bold**');
    await page.keyboard.type(' rendering');
    await page.keyboard.press('Enter');

    // Wait for message to render on the server round-trip
    await page.waitForTimeout(1500);

    const strongEl = page.locator('.msg-markdown strong').filter({ hasText: /bold/i });
    await expect(strongEl.last()).toBeVisible({ timeout: 5000 });
  });

  test('reply to a message', async ({ page }) => {
    await openFirstTicket(page);

    // Send an initial message so we have something to reply to.
    const textarea = page.locator('.ProseMirror');
    await textarea.fill('Initial message for reply test ' + Date.now());
    await textarea.press('Enter');
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

    // Verify reply banner appears above textarea with "Replying to" text.
    const replyBanner = page.getByText(/Replying to|Antwoord aan|Répondre|Repondre/i);
    await expect(replyBanner.first()).toBeVisible({ timeout: 3000 });

    // Type and send a reply
    await textarea.fill('This is a reply message ' + Date.now());
    await textarea.press('Enter');

    // Wait for message to be sent
    await page.waitForTimeout(2000);

    // Verify the sent message contains a QuoteBlock — current class is
    // `border-l-[3px] border-[var(--color-accent)]` (was `.border-accent-blue`).
    const lastSentBubble = page.locator('.bubble-sent').last();
    const quoteBlock = lastSentBubble.locator('.border-l-\\[3px\\]');
    await expect(quoteBlock).toBeVisible({ timeout: 5000 });
  });

  test('jump-to-bottom FAB', async ({ page }) => {
    await openFirstTicket(page);

    // Wait for messages to load
    await page.waitForTimeout(1500);

    // The FAB only appears when the message list is actually scrollable. Send
    // enough messages to guarantee scroll overflow.
    const textarea = page.locator('.ProseMirror');
    for (let i = 0; i < 12; i++) {
      await textarea.fill(`FAB seed message ${i + 1} — padding the scroll container so there is room to scroll back up`);
      await textarea.press('Enter');
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(800);

    // Find the scrollable message container
    const scrollContainer = page.locator('.overflow-y-auto.custom-scrollbar').first();
    await expect(scrollContainer).toBeVisible();

    // Sanity-check: the container must be scrollable for the FAB assertion to be meaningful.
    // 12 padded messages always overflow at the default Playwright viewport;
    // hard-fail if not (it would be a layout regression).
    const scrollable = await scrollContainer.evaluate((el) => el.scrollHeight > el.clientHeight + 10);
    expect(scrollable).toBe(true);

    // Scroll up to top to trigger the FAB
    await scrollContainer.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(300);

    // Dispatch scroll event to trigger the handler
    await scrollContainer.evaluate((el) => {
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    // The FAB button has aria-label "Scroll to bottom" (or localized variant).
    const fab = page.locator('button[aria-label*="scroll" i], button[aria-label*="défiler" i], button[aria-label*="naar beneden" i]');
    await expect(fab.first()).toBeVisible({ timeout: 3000 });

    // Click the FAB
    await fab.first().click();
    await page.waitForTimeout(500);

    // FAB should disappear after scrolling to bottom
    await expect(fab.first()).toBeHidden({ timeout: 3000 });
  });

  test('label picker opens and shows labels', async ({ page }) => {
    await openFirstTicket(page);

    // Wait for labels to load from store (tRPC query)
    await page.waitForTimeout(2000);

    // Find the "+" label button in the header (aria-label "Add label" or translated)
    const addLabelBtn = page.locator('button[aria-label="Add label"], button[aria-label="Label toevoegen"], button[aria-label="Ajouter un label"]');
    // Bundle D: assert the button is present. Label picker only renders when
    // `isSupport && allLabels.length > 0` — for the seeded acme partner with
    // labels seeded, this should always be visible. If it disappears that's a
    // real regression (label seed dropped, or role check broke).
    await expect(addLabelBtn).toBeVisible({ timeout: 10_000 });

    // Click to open the dropdown
    await addLabelBtn.click();

    // The LabelPicker dropdown has min-w-[220px] class.
    const dropdown = page.locator('.min-w-\\[220px\\]');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Verify it contains at least one label item.
    const labelItems = dropdown.locator('button');
    const labelCount = await labelItems.count();
    expect(labelCount).toBeGreaterThan(0);

    // Each label row contains a colored dot + a name span. Verify the first
    // row has visible text content.
    const firstLabelText = await labelItems.first().textContent();
    expect((firstLabelText || '').trim().length).toBeGreaterThan(0);
  });

  test('date separator renders', async ({ page }) => {
    await openFirstTicket(page);

    // Send a message so the conversation has at least one message + separator.
    const textarea = page.locator('.ProseMirror');
    await textarea.fill('Date separator test ' + Date.now());
    await textarea.press('Enter');
    await page.waitForTimeout(2000);

    // Date separators live at the TOP of each day-group. Scroll to top to
    // guarantee the first separator is in the DOM and unambiguously visible.
    const scrollContainer = page.locator('.overflow-y-auto.custom-scrollbar').first();
    if (await scrollContainer.isVisible({ timeout: 2000 }).catch(() => false)) {
      await scrollContainer.evaluate((el) => { el.scrollTop = 0; });
      await page.waitForTimeout(400);
    }

    // Date separators are centered pills styled with the soft-product
    // token: `bg-[var(--color-bg-elevated)] rounded-[var(--radius-pill)]`.
    const dateSeparator = page.locator('span.shrink-0.rounded-\\[var\\(--radius-pill\\)\\]').filter({
      hasText: /Today|Yesterday|Vandaag|Gisteren|Aujourd'hui|Hier|Mon|Tue|Wed|Thu|Fri|Sat|Sun|lun|mar|mer|jeu|ven|sam|dim|maa|din|woe|don|vri|zat|zon|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i,
    });

    // At least one date separator should be present (first message always gets one).
    await expect(dateSeparator.first()).toBeAttached({ timeout: 5000 });
  });

  test('multi-file upload input accepts multiple', async ({ page }) => {
    await openFirstTicket(page);

    await page.waitForTimeout(500);

    // Target the ComposeArea file input by its `accept` attribute.
    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await expect(fileInput).toHaveCount(1, { timeout: 5000 });

    // Verify it has the `multiple` attribute.
    await expect(fileInput).toHaveAttribute('multiple', '');

    // And that it accepts both images and documents
    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('image/');
    expect(accept).toContain('.pdf');
  });
});
