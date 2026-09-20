/**
 * E2E proof that the Talk2View assistant-ui runtime works through the STOCK
 * assistant-ui `<Thread />` — the same component the shadcn registry
 * generates for any assistant-ui app, unmodified (see
 * examples/react-assistant-ui/src/components/assistant-ui/).
 *
 * `tests/assistant-ui/runtime.test.tsx` proves the same story
 * at the primitives level (jsdom, no real browser); this spec proves it
 * through the full stock Thread in a real browser.
 *
 * Selectors below come from reading the generated
 * src/components/assistant-ui/elements/thread.aui.tsx and tool-fallback.aui.tsx —
 * they are assistant-ui's own labels and aria-labels, not anything Talk2View adds.
 */

import { test as base, expect, type Page } from '@playwright/test';
import {
  type MockControls,
  interruptSSE,
  mockAllApiRoutes,
  textResponseSSE,
} from './fixtures/api-mocks';

// ── Fixtures ────────────────────────────────────────────────────────────

const test = base.extend<{ mocks: MockControls }>({
  mocks: async ({ page }, use) => {
    const mocks = await mockAllApiRoutes(page);

    // A host element the Thread's React root never renders into, with an
    // inline style set before any of the page's own scripts run. Tailwind
    // preflight resets element defaults via a stylesheet — lower specificity
    // than an inline `style` attribute, so this element's computed style
    // proves whether anything (Tailwind, the Thread, the runtime) reaches
    // outside the page's own elements to restyle unrelated DOM. It also
    // records `document.documentElement`'s inline style before any script
    // runs, as the "no style leakage" test's control value.
    await page.addInitScript(() => {
      // `document.documentElement` doesn't exist yet at addInitScript time
      // (it runs before HTML parsing starts) — do everything inside the
      // DOMContentLoaded handler, which is itself registered before any of
      // the page's own scripts run.
      document.addEventListener('DOMContentLoaded', () => {
        (window as unknown as { __t2vControlHtmlStyle: string }).__t2vControlHtmlStyle =
          document.documentElement.getAttribute('style') ?? '';
        const host = document.createElement('div');
        host.setAttribute('data-host', '');
        host.style.fontFamily = 'Georgia, serif';
        host.style.color = 'rgb(18, 52, 86)';
        host.textContent = 'host content the example does not control';
        document.body.appendChild(host);
      });
    });

    // Dismiss any unexpected dialogs (e.g. alert from show_notification)
    page.on('dialog', (dialog) => dialog.accept());

    // Talk2View.chat() auto-starts an anonymous session on the first message
    // (this example renders no login form), and the runtime registers tools
    // in a mount-time effect — arm the waiter before navigation so it can't
    // race the first sendMessage.
    const toolsRegistered = page.waitForResponse('**/v1/tools/register');

    await page.goto('/');
    await expect(page.getByPlaceholder('Send a message...')).toBeVisible();
    await toolsRegistered;

    await use(mocks);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────

const EMAIL_ARGS = { to: 'user@test.com', subject: 'Hello', body: 'World' };

async function sendMessage(page: Page, text: string) {
  const input = page.getByPlaceholder('Send a message...');
  await input.fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

/**
 * The stock Thread collapses tool calls under a "N tool call(s)" group by
 * default (`ToolGroupRoot`'s `defaultOpen` is `false` — see
 * tool-group.aui.tsx) — expand it to reach the tool fallback / approval
 * card underneath.
 */
async function expandToolGroup(page: Page) {
  await page.getByRole('button', { name: '1 tool call' }).click();
}

// ── Tests ────────────────────────────────────────────────────────────────

test.describe('assistant-ui Thread on the Talk2View runtime', () => {
  test('a reply streams into an assistant message', async ({ page, mocks }) => {
    mocks.setMessageResponse(textResponseSSE('It is 3:45 PM.'));

    await sendMessage(page, 'What time is it?');

    await expect(page.getByText('It is 3:45 PM.')).toBeVisible();
  });

  test('a client tool without permission runs exactly once and resumes', async ({ page, mocks }) => {
    mocks.setMessageResponse(interruptSSE('get_current_page', 'call_page_1', {}));
    mocks.setResumeResponse(textResponseSSE('You are on the example page.'));

    await sendMessage(page, 'What page am I on?');

    await expect(page.getByText('You are on the example page.')).toBeVisible();

    // No approval card for this tool — it has no `permission: true`, so the
    // SDK runs it locally and resumes without waiting on the end-user.
    const resumes = mocks.getResumeRequests();
    expect(resumes).toHaveLength(1);
    expect(resumes[0].tool_call_id).toBe('call_page_1');
    expect(resumes[0].is_error).toBe(false);
    expect(resumes[0].result).toContain('"url"');
  });

  test('the approval gate: Allow once runs the tool and resumes', async ({ page, mocks }) => {
    mocks.setMessageResponse(interruptSSE('send_email', 'call_email_1', EMAIL_ARGS));

    await sendMessage(page, 'Send an email');
    await expandToolGroup(page);

    // assistant-ui's stock tool-fallback approval, rendered from the
    // options + labels the SDK declares (convert.ts's APPROVAL_OPTIONS) —
    // not a Talk2View component.
    const allowOnce = page.getByRole('button', { name: 'Allow once' });
    await expect(allowOnce).toBeVisible();
    await expect(page.getByRole('button', { name: 'Always allow' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible();

    mocks.setResumeResponse(textResponseSSE('Email sent successfully.'));
    await allowOnce.click();

    await expect(allowOnce).not.toBeVisible();
    await expect(page.getByText('Email sent successfully.')).toBeVisible();

    const resumes = mocks.getResumeRequests();
    expect(resumes).toHaveLength(1);
    expect(resumes[0].tool_call_id).toBe('call_email_1');
    expect(resumes[0].is_error).toBe(false);
    expect(resumes[0].result).toContain('user@test.com');
  });

  test('the approval gate: Deny with a reason resumes with feedback', async ({ page, mocks }) => {
    mocks.setMessageResponse(interruptSSE('send_email', 'call_email_2', EMAIL_ARGS));

    await sendMessage(page, 'Send another email');
    await expandToolGroup(page);

    const denyButton = page.getByRole('button', { name: 'Deny' });
    await expect(denyButton).toBeVisible();

    // The stock card offers a freeform text field (the SDK's approval sets
    // `allowFreeform: true`) — type a reason before denying.
    const note = page.getByPlaceholder('Add a note to your decision');
    await expect(note).toBeVisible();
    await note.fill('Wrong recipient');

    mocks.setResumeResponse(textResponseSSE('Understood, I will not send that email.'));
    await denyButton.click();

    await expect(denyButton).not.toBeVisible();
    await expect(page.getByText('Understood, I will not send that email.')).toBeVisible();

    const resumes = mocks.getResumeRequests();
    expect(resumes).toHaveLength(1);
    expect(resumes[0].is_error).toBe(true);
    expect(resumes[0].result).toContain('Wrong recipient');
  });

  test('stop ends the reply and leaves the composer usable', async ({ page, mocks }) => {
    // Override with a slow response so there's a window to click Stop before
    // any reply lands.
    await page.route('**/v1/sessions/*/messages', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: textResponseSSE('This reply should never be shown.'),
      });
    });

    await sendMessage(page, 'Tell me a long story');

    const stopButton = page.getByRole('button', { name: 'Stop generating' });
    await expect(stopButton).toBeVisible();
    await stopButton.click();

    // Outlast the delayed mock response, then confirm nothing from it landed.
    await page.waitForTimeout(2500);
    await expect(page.getByText('This reply should never be shown.')).not.toBeVisible();

    // The composer is back to its idle state — Send visible, input usable.
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
    const input = page.getByPlaceholder('Send a message...');
    await expect(input).toBeEditable();
    await input.fill('still works');
    await expect(input).toHaveValue('still works');
  });

  test('does not restyle the host page', async ({ page, mocks }) => {
    void mocks; // pulls in the shared fixture (mocked routes + navigation) — this test reads no mock state
    // Tailwind preflight (which this example ships, like any partner app
    // would) DOES reset element defaults — e.g. `document.body`'s font —
    // via its own stylesheet. That is expected and out of scope here: it is
    // the partner's own app being themed, not something leaking outward.
    // What must NOT happen is the runtime or the Thread reaching outside
    // their own React root to mutate arbitrary host DOM/styles. An inline
    // `style` attribute always wins over any stylesheet rule regardless of
    // load order, so a host element's computed style is untouched by
    // Tailwind preflight and proves the negative directly.
    const host = page.locator('[data-host]');
    await expect(host).toHaveCSS('color', 'rgb(18, 52, 86)');
    const fontFamily = await host.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain('Georgia');

    const htmlStyleNow = await page.evaluate(
      () => document.documentElement.getAttribute('style') ?? '',
    );
    const htmlStyleControl = await page.evaluate(
      () => (window as unknown as { __t2vControlHtmlStyle: string }).__t2vControlHtmlStyle,
    );
    expect(htmlStyleNow).toBe(htmlStyleControl);
  });
});
