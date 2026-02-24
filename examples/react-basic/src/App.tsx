/**
 * Minimal React integration example for Talk2View.
 *
 * This demonstrates:
 * 1. Setting up the T2VProvider with your partner key
 * 2. Using the pre-built LoginModal for authentication
 * 3. Registering client-side tools the agent can call
 * 4. Using the ChatPanel for the full chat experience
 */

import React from 'react';
import { T2VProvider, ChatPanel } from '@talk2view/sdk/react';
import type { ClientTool } from '@talk2view/sdk';

// Define tools that the AI agent can call in your application
const tools: ClientTool[] = [
  {
    name: 'show_notification',
    description: 'Show a notification message to the user',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title' },
        message: { type: 'string', description: 'Notification message' },
        type: { type: 'string', description: 'Notification type', enum: ['info', 'success', 'warning', 'error'] },
      },
      required: ['title', 'message'],
    },
    execute: async (args) => {
      // This runs in YOUR application — do whatever you want
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
];

export default function App() {
  return (
    <T2VProvider partnerKey="pk_test_ex_reactbasic_local_dev_12345" baseUrl="">
      <div style={{ display: 'flex', height: '100vh' }}>
        {/* Your application content */}
        <div style={{ flex: 1, padding: '32px' }}>
          <h1>My Application</h1>
          <p>This is your existing app. The Talk2View chat panel is on the right.</p>
        </div>

        {/* Talk2View chat panel — handles auth, tools, streaming automatically */}
        <div style={{ width: '400px', borderLeft: '1px solid #e0e0e0' }}>
          <ChatPanel tools={tools} />
        </div>
      </div>
    </T2VProvider>
  );
}
