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

**Band** — the score's label group, defined by two thresholds only: convicted (< 40), probationary (40..74), acquitted (≥ 75).

The canonical band values are exactly `'convicted' | 'probation' | 'acquitted'`. `'probation'` is the value, "probationary" is the human name for the same band, and the value is an external contract (the `verdict_type` analytics payload and the `data-verdict-type` attribute) — do not rename it.

A band is classified from the **canonical score**: a normalized integer in 0..100. Normalization (rounding, then clamping) happens before classification, so 39.5 bands as 40 (probationary) and 74.5 bands as 75 (acquitted).

The band is one rule; the words are not. The trial gauge labels a still-provisional score in its own vocabulary (GUILTY OF DELUSION / PROBATIONARY / BATTLE-TESTED), the sealed Verdict uses the canonical labels (CONVICTED OF DELUSION / PROBATIONARY RISK / STRESS-TESTED & ACQUITTED), and headline copy and tone class names are presentation, owned by the UI.

**Verdict** — the sealed outcome: `score`, `verdictType`, `verdictLabel`, `criticalBlindspot` (`{title, body}`), `strongestDefense`, `strongestPersona`, `prescriptions`.

The Verdict carries judgment only. It holds no Case identity (`docket`, `title`, `category`), no round count, and no transcript of the record: `strongestDefense` and `strongestPersona` are the judgment's summary of the record, not the record itself. The official document is assembled from three sources — the Case for identity, the Verdict for judgment, and the export timestamp — so the round count belongs to the Case (one round per Objection) and is read from there by every surface that displays it.

**Critical blindspot** — the single most dangerous unanswered risk, chosen by precedence: unpriced downside → missing exit ramp → unproven demand → copyability → execution drag.

**Trial** — the pre-mortem state machine over the three Personas, owned by the domain module as `makeTrial` / `answer` / `advance`: `activeRound` (the round on the stand), `score`, `rebuttals` (the record), `phase`, and `reaction` (the evaluation currently on screen). `makeTrial(initialScore)` starts it, `answer(trial, { rebuttal, caseData, evaluation })` records a defense and applies its delta, and `advance(trial, { caseData })` opens the next round or seals the Verdict from the record.

`phase` is `'witness'` (this round accepts an answer) or `'reaction'` (this round has been answered). It is load-bearing: `answer` refuses a second answer to an answered round, and `advance` refuses to move a trial that has not been answered — which is what makes a stale caller harmless.

The machine owns no timers, no navigation, and no draft text. The **reveal pause** between a round being answered and the next round opening is presentation timing owned by the UI, which is what makes it cancellable; the defense being typed is UI state, not Trial state.

## Canonical ownership

`src/lib/courtroom.js` owns the canonical representation of every concept above. The deterministic engine is the reference implementation of the analysis interface.

Providers (OpenAI / Anthropic) and the server seam in `lib/courtroom.ts` own **provider output**, which is untrusted by definition and must be translated into the canonical shapes before anything downstream reads it. A provider may supply objection `text`/`pressure`, a `personaId` per objection, and blindspot + prescription prose. It may not supply persona presentation, change the objection count or order, or escape the score envelope.

## Invariants

- Exactly three objections, one per Persona, in registry order; round index == persona index.
- `initialScore` sits inside the engine's starting envelope (18..61).
- Score is clamped to 0..100 at every step; the band thresholds 40 and 75 have one owner, and band values are the canonical `'convicted' | 'probation' | 'acquitted'` strings.
- Round `r` is answered by `PERSONAS[r]`: `answer` derives the Persona from the round, so the record cannot fall out of registry order.
- A trial that has not been answered cannot advance, and a finished trial does not advance again.
- The Verdict has one producer and one writer: `advance` seals it through `createVerdict`, and no other code constructs one or re-derives its fields.
- Every path returns a playable Case: a failed or malformed provider response falls back to the engine.
