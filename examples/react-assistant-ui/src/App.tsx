/**
 * Talk2View + assistant-ui integration example.
 *
 * Demonstrates:
 * 1. T2VAssistantProvider — combined provider (auth + runtime + tools)
 * 2. T2VLoginGate — shows login form when unauthenticated
 * 3. T2VThread — inline chat thread (assistant-ui powered)
 * 4. T2VAssistantModal — floating chat widget (bottom-right button)
 * 5. Client-side tools with human-in-the-loop approval
 *
 * Toggle between Thread (inline) and Modal (floating widget) modes
 * using the buttons at the top.
 */

import { useState } from 'react';
import {
  T2VAssistantProvider,
  T2VThread,
  T2VAssistantModal,
} from '@talk2view/sdk/ui';
import type { ClientTool } from '@talk2view/sdk';

// ── Client-side tools ──

const tools: ClientTool[] = [
  {
    name: 'show_notification',
    description: 'Show a notification message to the user',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title' },
        message: { type: 'string', description: 'Notification message' },
        type: {
          type: 'string',
          description: 'Notification type',
          enum: ['info', 'success', 'warning', 'error'],
        },
      },
      required: ['title', 'message'],
    },
    execute: async (args) => {
      alert(`${args.title}: ${args.message}`);
      return JSON.stringify({ success: true, message: 'Notification shown' });
    },
  },
  {
    name: 'get_current_page',
    description: 'Get information about the current page the user is viewing',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      return JSON.stringify({
        url: window.location.href,
        title: document.title,
        timestamp: new Date().toISOString(),
      });
    },
  },
  {
    name: 'send_email',
    description: 'Send an email on behalf of the user',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body text' },
      },
      required: ['to', 'subject', 'body'],
    },
    permission: true, // Always requires human approval
    execute: async (args) => {
      console.log('Sending email to:', args.to, 'subject:', args.subject);
      return JSON.stringify({ success: true, sent_to: args.to });
    },
  },
];

// ── App ──

type Mode = 'modal' | 'thread';

export default function App() {
  const [mode, setMode] = useState<Mode>('modal');

  return (
    <T2VAssistantProvider
      partnerKey="pk_test_ex_reactbasic_local_dev_12345"
      baseUrl=""
      tools={tools}
    >
      <div style={{ fontFamily: 'system-ui, sans-serif', height: '100vh', display: 'flex' }}>
        {/* Left panel — your app */}
        <div style={{ flex: 1, padding: '32px', overflow: 'auto' }}>
          <h1 style={{ marginTop: 0 }}>My Application</h1>
          <p style={{ color: '#666' }}>
            {mode === 'modal'
              ? 'Click the chat button in the bottom-right corner to open Talk2View.'
              : 'The Talk2View chat thread is inline on the right.'}
          </p>

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
            <button
              onClick={() => setMode('modal')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #e0e0e0',
                background: mode === 'modal' ? '#40D4B6' : '#fff',
                color: mode === 'modal' ? '#fff' : '#333',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Floating Modal
            </button>
            <button
              onClick={() => setMode('thread')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #e0e0e0',
                background: mode === 'thread' ? '#40D4B6' : '#fff',
                color: mode === 'thread' ? '#fff' : '#333',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Inline Thread
            </button>
          </div>

          <div style={{ marginTop: '24px', color: '#888', fontSize: '14px' }}>
            <p>Try asking the agent to:</p>
            <ul>
              <li>Show a notification</li>
              <li>Get the current page info</li>
              <li>Send an email (requires approval)</li>
            </ul>
          </div>
        </div>

        {/* Right panel — inline Thread mode */}
        {mode === 'thread' && (
          <div style={{ width: '420px', borderLeft: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column' }}>
            <T2VThread welcomeMessage="Hi! I can show notifications, check the page, or send emails. What would you like?" />
          </div>
        )}
      </div>

      {/* Floating modal — renders a fixed-position button + popover */}
      {mode === 'modal' && (
        <T2VAssistantModal welcomeMessage="Hi! I can show notifications, check the page, or send emails." />
      )}
    </T2VAssistantProvider>
  );
}
