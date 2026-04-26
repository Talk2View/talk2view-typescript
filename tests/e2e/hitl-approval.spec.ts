/**
 * E2E tests for the human-in-the-loop approval flow.
 *
 * Uses the react-basic example app with mocked API routes.
 * Verifies: approval card display, Allow Once, Allow Always,
 * Deny with feedback, and argument editing.
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

    // Dismiss any unexpected dialogs (e.g. alert from show_notification)
    page.on('dialog', (dialog) => dialog.accept());

    // Arm the tool-registration waiter BEFORE navigation — the Talk2View
    // provider registers tools in a mount-time effect, so the request fires
    // before login completes.
    const toolsRegistered = page.waitForResponse('**/v1/tools/register');

    await page.goto('/');

    // Log in
    await page.fill('#t2v-email', 'test@example.com');
    await page.fill('#t2v-password', 'password');
    await page.click('button:has-text("Sign in")');

    // Wait for chat panel ready
    await expect(page.getByText('How can I help you?')).toBeVisible();

    // Ensure tools are registered before the first sendMessage
    await toolsRegistered;

    await use(mocks);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────

const EMAIL_ARGS = { to: 'user@test.com', subject: 'Hello', body: 'World' };

async function sendMessage(page: Page, text: string) {
  const input = page.getByPlaceholder('Type a message…');
  await input.fill(text);
  await page.getByLabel('Send message').click();
}

function approvalCard(page: Page) {
  return page.getByRole('region', { name: /Tool approval required/ });
}

async function triggerApproval(page: Page, mocks: MockControls, callId = 'call_1') {
  mocks.setMessageResponse(interruptSSE('send_email', callId, EMAIL_ARGS));
  await sendMessage(page, 'Send an email');
  await expect(approvalCard(page)).toBeVisible();
}

// ── Tests ────────────────────────────────────────────────────────────────

test.describe('HITL Approval Flow', () => {
  test('tool call shows the approval card', async ({ page, mocks }) => {
    await triggerApproval(page, mocks);

    const card = approvalCard(page);

    // Card header shows tool name + description
    await expect(card.getByText('send_email')).toBeVisible();
    await expect(card.getByText(/Send an email on behalf of the user/)).toBeVisible();

    // Arguments are collapsed by default; expand and verify payload
    await card.getByRole('button', { name: /Show arguments/ }).click();
    await expect(card.getByText('"to": "user@test.com"')).toBeVisible();

    // Three action buttons
    await expect(card.getByRole('button', { name: 'Allow Once' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Allow Always' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Deny' })).toBeVisible();
  });

  test('Allow Once executes the tool and resumes', async ({ page, mocks }) => {
    await triggerApproval(page, mocks);

    mocks.setResumeResponse(textResponseSSE('Email sent successfully.'));
    await approvalCard(page).getByRole('button', { name: 'Allow Once' }).click();

    // Approval card disappears, response shows
    await expect(approvalCard(page)).not.toBeVisible();
    await expect(page.getByText('Email sent successfully.')).toBeVisible();

    // Verify the resume request
    const resumes = mocks.getResumeRequests();
    expect(resumes).toHaveLength(1);
    expect(resumes[0].tool_call_id).toBe('call_1');
    expect(resumes[0].is_error).toBe(false);
    expect(resumes[0].result).toContain('sent_to');
    expect(resumes[0].result).toContain('user@test.com');
  });

  test('Allow Always auto-approves subsequent calls', async ({ page, mocks }) => {
    // First call — manually approve with Always
    await triggerApproval(page, mocks, 'call_first');
    mocks.setResumeResponse(textResponseSSE('First email sent.'));
    await approvalCard(page).getByRole('button', { name: 'Allow Always' }).click();

    await expect(page.getByText('First email sent.')).toBeVisible();

    // Second call — should auto-approve (no card)
    mocks.clearResumeRequests();
    mocks.setMessageResponse(interruptSSE('send_email', 'call_second', EMAIL_ARGS));
    mocks.setResumeResponse(textResponseSSE('Second email sent.'));
    await sendMessage(page, 'Send another email');

    await expect(page.getByText('Second email sent.')).toBeVisible();
    // The approval card should NOT be shown
    await expect(approvalCard(page)).not.toBeVisible();

    // Verify auto-approved resume was sent
    const resumes = mocks.getResumeRequests();
    expect(resumes).toHaveLength(1);
    expect(resumes[0].tool_call_id).toBe('call_second');
    expect(resumes[0].is_error).toBe(false);
  });

  test('Deny sends feedback and agent continues', async ({ page, mocks }) => {
    await triggerApproval(page, mocks);
    const card = approvalCard(page);

    // Click Deny — shows feedback input
    await card.getByRole('button', { name: 'Deny' }).click();
    const feedback = card.getByPlaceholder('Reason for denying (optional)');
    await expect(feedback).toBeVisible();

    // Type feedback and confirm
    await feedback.fill('Wrong recipient');
    mocks.setResumeResponse(textResponseSSE('Understood, I will not send that email.'));
    await card.getByRole('button', { name: 'Confirm Deny' }).click();

    await expect(approvalCard(page)).not.toBeVisible();
    await expect(page.getByText('Understood, I will not send that email.')).toBeVisible();

    // Verify the resume sent a denial
    const resumes = mocks.getResumeRequests();
    expect(resumes).toHaveLength(1);
    expect(resumes[0].is_error).toBe(true);
    expect(resumes[0].result).toContain('User denied');
    expect(resumes[0].result).toContain('Wrong recipient');
  });

  test('Edit arguments then Allow Once sends updated input', async ({ page, mocks }) => {
    await triggerApproval(page, mocks);
    const card = approvalCard(page);

    // Expand arguments, then click Edit
    await card.getByRole('button', { name: /Show arguments/ }).click();
    await card.getByRole('button', { name: 'Edit' }).click();

    // Textarea should appear with current args
    const textarea = card.locator('textarea');
    await expect(textarea).toBeVisible();

    // Modify the arguments
    const updatedArgs = JSON.stringify(
      { to: 'new@test.com', subject: 'Changed', body: 'Updated' },
      null,
      2,
    );
    await textarea.fill(updatedArgs);

    // Approve with modified args
    mocks.setResumeResponse(textResponseSSE('Email sent to new address.'));
    await card.getByRole('button', { name: 'Allow Once' }).click();

    await expect(approvalCard(page)).not.toBeVisible();
    await expect(page.getByText('Email sent to new address.')).toBeVisible();

    // Verify the tool was executed with updated args
    const resumes = mocks.getResumeRequests();
    expect(resumes).toHaveLength(1);
    expect(resumes[0].is_error).toBe(false);
    expect(resumes[0].result).toContain('new@test.com');
  });
});
