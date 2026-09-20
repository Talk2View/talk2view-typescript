/**
 * The `examples/react-chat` app, driven in a real browser.
 *
 * The example's whole claim is that a partner needs three lines and no build
 * configuration: no Tailwind, no PostCSS, no copied component files. jsdom
 * cannot check that — it never applies the compiled stylesheet — so the smoke
 * that matters runs here.
 *
 * `tests/e2e/chat-hosts/` asks whether the chat survives someone else's CSS.
 * This asks whether the thing works at all: send a message, open Settings, open
 * Account, find the launcher.
 */
import { expect, test } from '@playwright/test';
import { mockAllApiRoutes, textResponseSSE } from './fixtures/api-mocks';

test.describe('the react-chat example, full pane', () => {
  test('sends a message and shows the reply', async ({ page }) => {
    const mocks = await mockAllApiRoutes(page);
    mocks.setMessageResponse(textResponseSSE('One component and one stylesheet.'));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'How can I help you today?' })).toBeVisible();

    const input = page.getByPlaceholder('Send a message...');
    await input.fill('What is this?');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText('One component and one stylesheet.')).toBeVisible();
  });

  test('seeds a suggestion straight into the thread', async ({ page }) => {
    const mocks = await mockAllApiRoutes(page);
    mocks.setMessageResponse(textResponseSSE('It is a chest CT report.'));

    await page.goto('/');
    await page.getByRole('button', { name: 'What is in this report?' }).click();

    await expect(page.getByText('It is a chest CT report.')).toBeVisible();
  });

  test('opens Settings over the thread', async ({ page }) => {
    await mockAllApiRoutes(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('AI model')).toBeVisible();
    // The thread stays mounted behind the view, so a half-typed message and the
    // scroll position survive the trip.
    await expect(page.locator('.aui-thread-root')).toHaveCount(1);
  });

  test('opens the Account view with a way in', async ({ page }) => {
    await mockAllApiRoutes(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Account' }).click();

    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('the dark toggle reaches the chat and the host page keeps its own', async ({ page }) => {
    await mockAllApiRoutes(page);
    await page.goto('/');
    const thread = page.locator('.aui-thread-root');
    await expect(thread).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await page.getByTestId('dark-toggle').click();
    await expect(thread).toHaveCSS('background-color', 'rgb(2, 28, 37)');
    // The example's own dark page is its own CSS, nothing to do with the chat.
    await expect(page.locator('body')).toHaveClass(/dark-page/);
  });
});

test.describe('the react-chat example, launcher', () => {
  test('introduces itself in the corner, with the beam running', async ({ page }) => {
    await mockAllApiRoutes(page);
    await page.goto('/launcher');

    const button = page.locator('.aui-modal-button');
    await expect(button).toBeVisible();
    await expect(page.getByText('Ask Talk2View')).toBeVisible();

    expect(
      await page.evaluate(() => {
        const anchor = document.querySelector('.aui-modal-anchor')!;
        const trigger = document.querySelector('.aui-modal-button')!;
        return {
          anchorPosition: getComputedStyle(anchor).position,
          beam: getComputedStyle(trigger, '::before').animationName,
          tile: getComputedStyle(trigger).backgroundColor,
        };
      }),
    ).toEqual({ anchorPosition: 'fixed', beam: 't2v-beam', tile: 'rgb(38, 200, 184)' });
  });

  test('opens the panel over the host page and answers there', async ({ page }) => {
    const mocks = await mockAllApiRoutes(page);
    mocks.setMessageResponse(textResponseSSE('Answered from the panel.'));

    await page.goto('/launcher');
    await page.locator('.aui-modal-button').click();
    await expect(page.locator('.aui-modal-content')).toBeVisible();

    await page.getByPlaceholder('Send a message...').fill('Hello from the corner');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Answered from the panel.')).toBeVisible();

    // The report behind it is the host's own, untouched.
    await expect(page.getByRole('heading', { name: 'Northfield Imaging' })).toBeVisible();
  });

  test('darkens the panel as well as the tile', async ({ page }) => {
    await mockAllApiRoutes(page);
    await page.goto('/launcher');
    await page.getByTestId('dark-toggle').click();
    await page.locator('.aui-modal-button').click();

    // The panel renders in the portal host, outside the element `className`
    // lands on — the theme has to be carried out to it deliberately.
    await expect(page.locator('.aui-modal-content')).toHaveCSS('background-color', 'rgb(11, 39, 49)');
  });
});

test.describe('the example on its own', () => {
  test('`?mock=1` runs the chat with no engine and no test-side mocking', async ({ page }) => {
    // Nothing is intercepted here. The example answers its own requests, which
    // is what lets anyone clone the repo and see the chat work in one command.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/?mock=1');
    await page.getByPlaceholder('Send a message...').fill('Hello');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText(/one component and one stylesheet/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('asks before running a tool, then runs it in the host page', async ({ page }) => {
    await page.goto('/?mock=1');
    await page.getByPlaceholder('Send a message...').fill('Highlight the nodule for me');
    await page.getByRole('button', { name: 'Send message' }).click();

    // The tool is declared `permission: true`, so the packaged approval card
    // appears with the host's own description of what is about to happen.
    await expect(page.getByText('The assistant wants to run highlight_finding')).toBeVisible();
    await expect(page.getByText(/Highlighting/)).toBeVisible();

    await page.getByRole('button', { name: 'Allow once' }).click();

    // The host app's own handler ran: the passage in its report is highlighted.
    await expect(
      page.locator('[data-highlightable]', { hasText: 'stable 4 mm right lower lobe nodule' }).first(),
    ).toHaveCSS('background-color', 'rgb(202, 235, 235)');
  });
});
