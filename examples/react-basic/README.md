# Talk2View — React Basic Example

Minimal example showing how to integrate Talk2View into a React application.

## Setup

1. Get a partner key. Talk2View is in private beta:
   [request one](https://talk2view.com/resources/contact?subject=partner-key)
2. Update `src/App.tsx` with your `partnerKey`
3. Run:

```bash
npm install
npm run dev
```

## What this demonstrates

- `<Talk2View>` (from `@talk2view/sdk/ui`) wraps the app with SDK context
- `ChatPanel` provides the full chat UI (login, messages, input)
- Client tools are defined with schemas and `execute` functions
- Tool calls from the AI agent run locally in your app
