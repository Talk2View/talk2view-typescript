/**
 * API mock helpers for Playwright e2e tests.
 *
 * Intercepts all Talk2View API routes via page.route() and returns
 * configurable SSE responses for streaming endpoints.
 */

import type { Page } from '@playwright/test';

// ── SSE body builders ──────────────────────────────────────────────────

function chunk(overrides: Record<string, unknown>) {
  return {
    id: `chunk_${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4o',
    ...overrides,
  };
}

/** SSE body with a text response followed by stop. */
export function textResponseSSE(text: string): string {
  const textChunk = chunk({
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  });
  const stopChunk = chunk({
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    thread_id: 'thread_456',
  });
  return (
    `data: ${JSON.stringify(textChunk)}\n\n` +
    `data: ${JSON.stringify(stopChunk)}\n\n` +
    `data: [DONE]\n\n`
  );
}

/** SSE body with a tool call interrupt. */
export function interruptSSE(
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
): string {
  const interruptChunk = chunk({
    choices: [{ index: 0, delta: {}, finish_reason: null }],
    interrupt: {
      type: 'tool_call',
      tool_name: toolName,
      tool_call_id: toolCallId,
      arguments: args,
    },
  });
  return (
    `data: ${JSON.stringify(interruptChunk)}\n\n` +
    `data: [DONE]\n\n`
  );
}

// ── Mock controls ──────────────────────────────────────────────────────

export interface ResumeRequest {
  tool_call_id: string;
  result: string;
  is_error: boolean;
}

export interface MockControls {
  /** Set the SSE body for the next /messages POST. */
  setMessageResponse(body: string): void;
  /** Set the SSE body for the next /resume POST. */
  setResumeResponse(body: string): void;
  /** Get all captured /resume request bodies. */
  getResumeRequests(): ResumeRequest[];
  /** Clear captured resume requests. */
  clearResumeRequests(): void;
}

// ── Route setup ────────────────────────────────────────────────────────

export async function mockAllApiRoutes(page: Page): Promise<MockControls> {
  let nextMessageResponse = textResponseSSE('Hello! How can I help?');
  let nextResumeResponse = textResponseSSE('Done.');
  const resumeRequests: ResumeRequest[] = [];

  // POST /v1/auth/login
  await page.route('**/v1/auth/login', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'fake_access_token',
        refresh_token: 'fake_refresh_token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'user_1', email: 'test@example.com' },
      }),
    });
  });

  // POST /v1/auth/logout
  await page.route('**/v1/auth/logout', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // POST /v1/auth/anonymous — used by apps (like the assistant-ui example)
  // that never render a login form: Talk2View.chat() auto-starts an
  // anonymous session on the first message when nothing is authenticated.
  await page.route('**/v1/auth/anonymous', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'fake_anonymous_access_token',
        refresh_token: 'fake_anonymous_refresh_token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'anon_1', email: '' },
      }),
    });
  });

  // GET /v1/config
  await page.route('**/v1/config', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        default_llm_model: 'gpt-4o',
        default_stt_model: null,
        system_prompt: null,
      }),
    });
  });

  // GET /v1/models
  await page.route('**/v1/models', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        object: 'list',
        data: [{ id: 'gpt-4o', object: 'model', created: 0, owned_by: 'openai' }],
      }),
    });
  });

  // GET /v1/audio/models
  await page.route('**/v1/audio/models', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ object: 'list', data: [] }),
    });
  });

  // POST /v1/tools/register
  await page.route('**/v1/tools/register', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        registered: ['show_notification', 'get_current_page', 'send_email'],
        count: 3,
      }),
    });
  });

  // POST /v1/sessions
  await page.route('**/v1/sessions', (route, request) => {
    if (request.method() === 'POST' && !request.url().includes('/messages') && !request.url().includes('/resume')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'sess_123',
          thread_id: 'thread_456',
          model: 'gpt-4o',
        }),
      });
    } else {
      route.fallback();
    }
  });

  // POST /v1/sessions/*/messages — SSE stream
  await page.route('**/v1/sessions/*/messages', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: nextMessageResponse,
    });
  });

  // POST /v1/sessions/*/resume — capture body + SSE stream
  await page.route('**/v1/sessions/*/resume', async (route, request) => {
    const body = request.postDataJSON() as ResumeRequest;
    resumeRequests.push(body);
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: nextResumeResponse,
    });
  });

  // DELETE /v1/sessions/*
  await page.route('**/v1/sessions/*', (route, request) => {
    if (request.method() === 'DELETE') {
      route.fulfill({ status: 204 });
    } else {
      route.fallback();
    }
  });

  return {
    setMessageResponse(body: string) {
      nextMessageResponse = body;
    },
    setResumeResponse(body: string) {
      nextResumeResponse = body;
    },
    getResumeRequests() {
      return [...resumeRequests];
    },
    clearResumeRequests() {
      resumeRequests.length = 0;
    },
  };
}
