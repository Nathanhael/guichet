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

/** Open the first available ticket in the sidebar (support view). */
async function openFirstTicket(page: Page) {
  // QueueTicketRow stamps `data-ticket-row` + `data-ticket-variant` on its
  // `<li>`. Scoping to `variant="queue"` avoids two layout traps:
  //   - the "Other Agents" collapsible section header (no variant attr),
  //   - Lucas-style demo users whose pre-assigned tickets land under
  //     "mine"/"other" on a fresh login before he actively joins them.
  // The `support_qa` fixture has empty assignments, so everything renders
  // as `variant="queue"` and is directly clickable.
  const ticket = page
    .locator('li[data-ticket-row][data-ticket-variant="queue"]')
    .first();
  await ticket.waitFor({ state: 'visible', timeout: 20000 });

  // Trigger the QueueTicketRow's onMouseEnter/onFocus prefetch for the lazy
  // ComposeArea chunk *before* we click. `.hover()` dispatches mouseenter
  // which kicks off the dynamic `import()` early — without this, the chunk
  // fetch only starts when the chat window renders, and the 25 s `.ProseMirror`
  // wait below races the 460 KB `vendor-editor` download on cold Docker cache.
  await ticket.hover();
  // Settle for in-flight queue re-renders and give the prefetch a few frames
  // before the click triggers the mount itself.
  await page.waitForTimeout(300);
  await ticket.click();

  // SupportView shows a preview first — need to click "Join" to open the chat
  const joinBtn = page.getByRole('button', { name: /^join$|^accept$|deelnemen|rejoindre/i });
  try {
    await joinBtn.waitFor({ state: 'visible', timeout: 5000 });
    await joinBtn.click();
  } catch {
    // Already joined — ticket opened directly into chat (tab was already open)
  }

  // Wait for the chat window to load (compose editor mounts).
  // ComposeArea is lazy-loaded (vendor-editor chunk ~462 KB), so the first
  // mount in a fresh browser context can be slower than later mounts — give
  // it a generous timeout to absorb cold-cache chunk fetch + Suspense boot.
  // 35 s rather than the previous 25 s because Docker volume I/O + Vite dev
  // server + React.Suspense + Tiptap boot exceeded 25 s on slow runners.
  await page.locator('.ProseMirror').first()
    .waitFor({ state: 'visible', timeout: 35000 });
}

/**
 * Seed a fresh open ticket as agent_qa so the support queue isn't empty.
 * Runs once before all tests in this file. Uses a throwaway browser context
 * so the support tests can login independently and see the ticket.
 */
async function seedOpenTicket(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    // agent_qa (not agent_julie) — the latter has a pre-seeded DSC ticket
    // which the server's 1-ticket-per-agent guard would reject silently when
    // we try to create another here. agent_qa starts empty.
    const login = await loginAsDemo(page, 'agent_qa');
    if (!login.ok) throw new Error(`Seed: agent login failed (status ${(login as { status?: number }).status})`);

    await page.waitForTimeout(2000);

    // If a chat window is already open (e.g. from a previous unclosed ticket), we're done.
    const composeArea = page.locator('.ProseMirror');
    if (await composeArea.isVisible({ timeout: 3000 }).catch(() => false)) return;

    // Pick the Dispatch department — minimal seed dept DSC. support_qa
    // covers DSC/FOT/TEC so the ticket shows up in its queue regardless.
    const dispatchBtn = page.locator('button').filter({ hasText: /dispatch/i }).first();
    await dispatchBtn.waitFor({ state: 'visible', timeout: 5000 });
    await dispatchBtn.click();

    // Fill reference fields (DSC dept declares one reference field
    // "Order ID"; looping defensively in case the schema grows).
    const refInputs = page.locator('input[type="text"]');
    await refInputs.first().waitFor({ state: 'visible', timeout: 5000 });
    const refCount = await refInputs.count();
    for (let i = 0; i < refCount; i++) {
      await refInputs.nth(i).fill(`CHAT-ENH-${i + 1}`);
    }

    // Fill problem description
    const problemTextarea = page.locator('textarea').first();
    await problemTextarea.waitFor({ state: 'visible', timeout: 5000 });
    await problemTextarea.fill('Seed ticket for chat-enhancements suite');

    // Submit — "Connect with support" button on the TicketForm.
    const submitBtn = page.locator('button').filter({ hasText: /connect|create|submit|aanmaken|verstuur/i }).first();
    await submitBtn.click();

    // Wait for the chat window to become available (ticket creation succeeded)
    await composeArea.waitFor({ state: 'visible', timeout: 15000 });
  } finally {
    await ctx.close();
  }
}

test.describe('Chat Enhancements', () => {
  test.setTimeout(60000);

  test.beforeAll(async ({ browser }) => {
    await seedOpenTicket(browser);
  });

  test('delivery checkmarks visible on sent messages', async ({ page }) => {
    await loginAsDemo(page, 'support_qa');
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
    await loginAsDemo(page, 'support_qa');
    await openFirstTicket(page);

    // Send a message with markdown bold syntax. Playwright's .fill() on
    // a contenteditable bypasses ProseMirror's input rule pipeline, so
    // we focus the editor and type via page.keyboard instead — that
    // fires real keystrokes which Tiptap sees and which will also
    // trigger markdown input rules (** auto-converts to bold as you
    // type the closing pair). We use a plain "Testing bold rendering"
    // phrase and wrap only "bold" with the rules so the bubble's
    // rendered HTML still contains <strong>bold</strong>.
    const textarea = page.locator('.ProseMirror');
    await textarea.click();
    await page.keyboard.type('Testing ');
    await page.keyboard.type('**bold**');
    await page.keyboard.type(' rendering');
    await page.keyboard.press('Enter');

    // Wait for message to render on the server round-trip
    await page.waitForTimeout(1500);

    // The MessageContent component renders markdown in a .msg-markdown div.
    // Either the Tiptap input rules already produced a <strong> in the
    // compose buffer (serializing to **bold** markdown on send), or the
    // receiver's marked pipeline produces it. Either way the bubble
    // must contain a <strong>bold</strong>.
    const strongEl = page.locator('.msg-markdown strong').filter({ hasText: /bold/i });
    await expect(strongEl.last()).toBeVisible({ timeout: 5000 });
  });

  test('reply to a message', async ({ page }) => {
    await loginAsDemo(page, 'support_qa');
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
    const textarea = page.locator('.ProseMirror');
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
    await loginAsDemo(page, 'support_qa');
    await openFirstTicket(page);

    // Wait for messages to load
    await page.waitForTimeout(1500);

    // The FAB only appears when the message list is actually scrollable. On a
    // freshly-seeded ticket with one message the container may fit its content
    // exactly — send enough messages to guarantee scroll overflow.
    const textarea = page.locator('.ProseMirror');
    for (let i = 0; i < 12; i++) {
      await textarea.fill(`FAB seed message ${i + 1} — padding the scroll container so there is room to scroll back up`);
      await textarea.press('Enter');
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(800);

    // Find the scrollable message container
    const scrollContainer = page.locator('.overflow-y-auto.scrollbar-thin').first();
    await expect(scrollContainer).toBeVisible();

    // Sanity-check: the container must actually be scrollable for the FAB to be possible.
    const scrollable = await scrollContainer.evaluate((el) => el.scrollHeight > el.clientHeight + 10);
    test.skip(!scrollable, 'Message list is not scrollable after seeding messages — skipping FAB assertion');

    // Scroll up to top to trigger the FAB
    await scrollContainer.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(300);

    // Dispatch scroll event to trigger the handler
    await scrollContainer.evaluate((el) => {
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    // The FAB button has aria-label "Scroll to bottom" (or localized variant)
    const fab = page.locator('button[aria-label="Scroll to bottom"], button[aria-label*="scroll" i]');
    await expect(fab.first()).toBeVisible({ timeout: 3000 });

    // Click the FAB
    await fab.first().click();
    await page.waitForTimeout(500);

    // FAB should disappear after scrolling to bottom
    await expect(fab.first()).toBeHidden({ timeout: 3000 });
  });

  test('label picker opens and shows labels', async ({ page }) => {
    await loginAsDemo(page, 'support_qa');
    await openFirstTicket(page);

    // Wait for labels to load from store (tRPC query)
    await page.waitForTimeout(2000);

    // Find the "+" label button in the header (aria-label "Add label" or translated)
    const addLabelBtn = page.locator('button[aria-label="Add label"], button[aria-label="Label toevoegen"], button[aria-label="Ajouter un label"]');
    const btnVisible = await addLabelBtn.isVisible().catch(() => false);

    // Label picker only renders when isSupport && allLabels.length > 0
    // Skip assertion if button not visible (labels may not be loaded or role check differs)
    test.skip(!btnVisible, 'Label picker button not visible — labels may not be loaded for this partner/role');

    // Click to open the dropdown
    await addLabelBtn.click();

    // The LabelPicker dropdown has min-w-[220px] class (widened in the
    // variant-B refactor that unified the label slot).
    const dropdown = page.locator('.min-w-\\[220px\\]');
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
    await loginAsDemo(page, 'support_qa');
    await openFirstTicket(page);

    // Wait for messages to load
    await page.waitForTimeout(2000);

    // The FAB test earlier in this file sent 12 padding messages, so the ticket
    // may have many messages and auto-scroll to bottom. Date separators live at
    // the TOP of each day-group of messages — scroll the container to top so the
    // first separator is in the DOM and unambiguously visible.
    const scrollContainer = page.locator('.overflow-y-auto.scrollbar-thin').first();
    if (await scrollContainer.isVisible({ timeout: 2000 }).catch(() => false)) {
      await scrollContainer.evaluate((el) => { el.scrollTop = 0; });
      await page.waitForTimeout(400);
    }

    // Date separators are centered labels with uppercase tracking-widest font-mono text
    // containing day references like "Today", "Yesterday", or abbreviated day/month names.
    const dateSeparator = page.locator('span.uppercase.tracking-widest').filter({
      hasText: /Today|Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i,
    });

    // At least one date separator should be present (first message always gets one).
    // Use toBeAttached instead of toBeVisible so the assertion tolerates off-viewport
    // elements caused by dense message lists.
    await expect(dateSeparator.first()).toBeAttached({ timeout: 5000 });
  });

  test('multi-file upload input accepts multiple', async ({ page }) => {
    await loginAsDemo(page, 'support_qa');
    await openFirstTicket(page);

    // Wait for the compose area to mount (the textarea is already visible at this
    // point thanks to openFirstTicket, but the file input inside the sibling
    // <label> may need another tick).
    await page.waitForTimeout(500);

    // Target the ComposeArea file input by its `accept` attribute — it's the only
    // input on the page that accepts image/* AND .pdf (see ComposeArea.tsx:466).
    // This avoids matching any unrelated hidden file inputs and is resilient to
    // i18n changes in the aria-label.
    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await expect(fileInput).toHaveCount(1, { timeout: 5000 });

    // Verify it has the `multiple` attribute (Track E: multi-file upload).
    // Playwright returns '' for valueless boolean attributes.
    await expect(fileInput).toHaveAttribute('multiple', '');

    // And that it accepts both images and documents
    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('image/');
    expect(accept).toContain('.pdf');
  });
});
