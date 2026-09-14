# CONTEXT

Domain language for The Devil's Advocate (pre-mortem courtroom). These are the names to use in code, tests, and architecture reviews. Architecture vocabulary (module, interface, depth, seam, adapter, leverage, locality) stays in the shared codebase-design glossary.

## Concepts

**Case** — one decision submitted for pre-mortem. What the app holds as `caseFile`: the intake facts, its Docket, and its analysis.

**Case input** — the three facts a Case starts as: `title`, `plan`, `category`. Intake rules today live in the docket form (title ≤ 120 chars, plan ≥ 12 words), not in the domain module.

**Docket** — the display id for a Case, `#CASE-1234`. Generated per run; not persisted anywhere.

**Persona** — one of exactly three adversarial critics: `cfo` (The Cynical CFO), `parent` (The Disappointed Parent), `competitor` (The Paranoid Competitor). The registry in `src/lib/courtroom.js` is the canonical source of a Persona, including its presentation fields (`initials`, `color`, `accent`, `soft`). Personas are code, never model output: a provider may only *reference* a Persona by id.

**Objection** — the challenge one Persona raises in one round: `text` plus `pressure`, attached to the `persona` that raises it.

**Rebuttal** — the petitioner's answer to one Objection, with the evaluation the engine returns for it: `delta` and `quality`.

**Survivability score** — the 0..100 score on the record. Starts at the analysis's `initialScore` (engine envelope 20..60; clamp 18..61), moves by each Rebuttal's `delta` (−5..13), and is clamped to 0..100 before the Verdict.

**Band** — the score's label group: convicted (< 40), probationary (40..74), acquitted (≥ 75). The thresholds are one rule with several presentations (gauge label, verdict type, stamp tone, headline).

**Verdict** — the sealed outcome: `score`, `verdictType`, `verdictLabel`, `criticalBlindspot` (`{title, body}`), `strongestDefense`, `strongestPersona`, `prescriptions`.

**Critical blindspot** — the single most dangerous unanswered risk, chosen by precedence: unpriced downside → missing exit ramp → unproven demand → copyability → execution drag.

**Trial** — the three-round sequence over the three Personas: `activeRound`, `score`, `rebuttals`, `phase`.

## Canonical ownership

`src/lib/courtroom.js` owns the canonical representation of every concept above. The deterministic engine is the reference implementation of the analysis interface.

Providers (OpenAI / Anthropic) and the server seam in `lib/courtroom.ts` own **provider output**, which is untrusted by definition and must be translated into the canonical shapes before anything downstream reads it. A provider may supply objection `text`/`pressure`, a `personaId` per objection, and blindspot + prescription prose. It may not supply persona presentation, change the objection count or order, or escape the score envelope.

## Invariants

- Exactly three objections, one per Persona, in registry order; round index == persona index.
- `initialScore` sits inside the engine's starting envelope (18..61).
- Score is clamped to 0..100 at every step; band thresholds 40 and 75 live in one place.
- Every path returns a playable Case: a failed or malformed provider response falls back to the engine.
