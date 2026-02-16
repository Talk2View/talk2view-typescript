# Talk2View — React Basic Example

Minimal example showing how to integrate Talk2View into a React application.

## Setup

1. Get your partner key from the Talk2View dashboard
2. Update `src/App.tsx` with your `partnerKey`
3. Run:

```bash
npm install
npm run dev
```

## What this demonstrates

- `T2VProvider` wraps the app with SDK context
- `ChatPanel` provides the full chat UI (login, messages, input)
- Client tools are defined with schemas and `execute` functions
- Tool calls from the AI agent run locally in your app
