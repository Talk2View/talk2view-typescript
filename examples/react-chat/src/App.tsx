/**
 * The packaged chat in a host with no Tailwind.
 *
 * Three lines do the whole job:
 *
 *   import { Talk2ViewChat } from '@talk2view/sdk/chat';
 *   import '@talk2view/sdk/chat.css';
 *   <Talk2ViewChat partnerKey="pk_live_…" />
 *
 * Everything else in this file is the example's own page furniture: a route
 * switch, a dark toggle, and a report for the launcher to float over.
 */
import { useState } from 'react';
import type { ClientTool } from '@talk2view/sdk';
import { Talk2ViewChat, Talk2ViewChatLauncher } from '@talk2view/sdk/chat';
import '@talk2view/sdk/chat.css';
import './styles.css';

/** A tool the agent can ask to run. It executes here, in the host app. */
const tools: ClientTool[] = [
  {
    name: 'highlight_finding',
    description: 'Highlight a passage in the open report',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The passage to highlight' } },
      required: ['text'],
    },
    // Ask the end-user first: the approval card is part of the packaged chat.
    permission: true,
    execute: async (args) => {
      const passage = String(args.text ?? '');
      document.querySelectorAll<HTMLElement>('[data-highlightable]').forEach((el) => {
        if (el.textContent?.includes(passage)) el.style.background = '#CAEBEB';
      });
      return JSON.stringify({ highlighted: passage });
    },
  },
];

const chatProps = {
  partnerKey: 'pk_example_react_chat',
  baseUrl: '/api',
  tools,
  welcome: {
    heading: 'How can I help you today?',
    suggestions: [
      'What is in this report?',
      'Highlight the nodule for me',
      'What can you do?',
    ],
  },
  // Plain English, in the host's own words, for the two hooks the approval card
  // reads. `isToolDestructive` is the host's own claim about its own tool —
  // nothing verifies it.
  describeToolActivity: (name: string, args?: Record<string, unknown>) =>
    name === 'highlight_finding' ? `Highlighting “${String(args?.text ?? '')}”` : null,
  isToolDestructive: (name: string) => name === 'highlight_finding',
  resetPasswordUrl: 'https://talk2view.com/reset-password',
};

function Report() {
  return (
    <main className="report">
      <h1>Northfield Imaging</h1>
      <p className="meta">Reporting workspace · Study 2026-0918-114</p>

      <h2>Findings</h2>
      <p data-highlightable>
        The lungs are clear with no focal consolidation, pleural effusion or pneumothorax. The
        cardiomediastinal silhouette is within normal limits for the patient&rsquo;s age and habitus.
      </p>
      <p data-highlightable>
        Comparison is made with the prior study of 14 March. The previously noted stable 4 mm right
        lower lobe nodule is unchanged in size and morphology.
      </p>

      <h2>Impression</h2>
      <ol>
        <li data-highlightable>No acute cardiopulmonary process.</li>
        <li data-highlightable>Stable 4 mm right lower lobe nodule; no further imaging indicated.</li>
        <li data-highlightable>Degenerative change of the thoracic spine, unchanged.</li>
      </ol>

      <table>
        <thead>
          <tr>
            <th>Series</th>
            <th>Images</th>
            <th>Thickness</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Scout</td>
            <td>2</td>
            <td>&mdash;</td>
          </tr>
          <tr>
            <td>Axial chest</td>
            <td>318</td>
            <td>1.0 mm</td>
          </tr>
          <tr>
            <td>Coronal MPR</td>
            <td>96</td>
            <td>3.0 mm</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

export default function App() {
  const launcherRoute = window.location.pathname.startsWith('/launcher');
  const [dark, setDark] = useState(false);

  // The chat's dark mode is `dark` on the chat's own container — the same
  // class shadcn uses, scoped to `.t2v-chat` so it never touches the page.
  // The page's own dark mode is this example's business, and separate.
  document.body.classList.toggle('dark-page', dark);

  const query = window.location.search;

  return (
    <>
      <header className="topbar">
        <span className="brand">@talk2view/sdk/chat</span>
        <nav>
          <a href={`/${query}`} aria-current={launcherRoute ? undefined : 'page'}>
            Full pane
          </a>
          <a href={`/launcher${query}`} aria-current={launcherRoute ? 'page' : undefined}>
            Launcher
          </a>
          <button type="button" onClick={() => setDark((d) => !d)} data-testid="dark-toggle">
            {dark ? 'Light' : 'Dark'}
          </button>
        </nav>
      </header>

      {launcherRoute ? (
        <>
          <Report />
          <Talk2ViewChatLauncher
            {...chatProps}
            className={dark ? 'dark' : undefined}
            colourway="smoke-teal"
            visitorColourway
          />
        </>
      ) : (
        <div className="pane-route">
          <Report />
          <div className="chat-frame">
            <Talk2ViewChat {...chatProps} className={dark ? 'dark' : undefined} />
          </div>
        </div>
      )}
    </>
  );
}
