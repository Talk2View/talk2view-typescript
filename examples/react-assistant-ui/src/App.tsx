/**
 * Talk2View + stock assistant-ui integration example.
 *
 * The point of this example: nothing here is Talk2View UI. `<Thread />` is
 * the unmodified assistant-ui component the shadcn registry generated
 * (`src/components/assistant-ui/`) — the same component any assistant-ui
 * app would render. `useTalk2ViewRuntime` is the only Talk2View-specific
 * line: it plugs the SDK in at assistant-ui's runtime seam so the stock
 * Thread streams replies, runs client tools, and shows tool approvals
 * without any custom rendering code.
 */

import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useTalk2ViewRuntime } from '@talk2view/sdk/assistant-ui';
import type { ClientTool } from '@talk2view/sdk';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';

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
  {
    // Static permission: always requires human approval (shows approval card)
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
    permission: true,
    execute: async (args) => {
      // In a real app, this would send an email via your backend
      console.log('Sending email to:', args.to, 'subject:', args.subject);
      return JSON.stringify({ success: true, sent_to: args.to });
    },
  },
];

const partnerKey = import.meta.env.VITE_T2V_PARTNER_KEY ?? 'pk_test_example';
const baseUrl = import.meta.env.VITE_T2V_BASE_URL;

export default function App() {
  const runtime = useTalk2ViewRuntime({
    partnerKey,
    ...(baseUrl ? { baseUrl } : {}),
    tools,
  });

  return (
    <div style={{ height: '100vh' }}>
      <AssistantRuntimeProvider runtime={runtime}>
        <Thread />
      </AssistantRuntimeProvider>
    </div>
  );
}
