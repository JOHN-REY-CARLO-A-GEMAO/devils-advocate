# The Devil's Advocate // Pre-Mortem Division

A dark-mode cyber-legal thriller for pressure-testing major decisions before reality does it for you.

## Run it

```bash
npm install
npm run dev
```

The app ships with a deterministic, keyword-aware mock engine, so it is playable without any API key. It includes:

- Case docket intake with validation and risk-category tags
- Three sequential critics with animated witness stand transitions
- Rebuttal quality scoring, reactions, score gauge, bail-out telemetry
- Cinematic jury deliberation intermission
- Verdict stamp, critical blindspot, strongest defense, and jury prescription
- Official PDF export via `jspdf`
- Optional PostHog capture through `window.posthog.capture`

## Optional server-side AI

`lib/courtroom.ts` is a server-only adapter seam. Wire `generateCourtroomCase` to a Next.js route, edge function, or API server and set either `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the server environment. Never expose those keys in the browser. If a configured provider errors, the adapter returns a safe mock result.

## Analytics

The client calls the requested event names through `captureEvent`, which forwards to an installed PostHog client when `window.posthog` exists and also emits a `courtroom:analytics` browser event for local debugging.
