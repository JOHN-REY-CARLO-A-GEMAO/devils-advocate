// Card 2: the trial state machine's contract. These drive the real implementation in
// src/lib/courtroom.js — not a copy of the sequence — so the suite can no longer drift from
// the machine the app actually runs.
import test from 'node:test'
import assert from 'node:assert/strict'

import { PERSONAS, advance, analyzeCase, answer, evaluateRebuttal, makeTrial } from '../src/lib/courtroom.js'

const CASE_INPUT = {
  title: 'Quit my job to build a niche newsletter',
  plan: 'I will keep a 6 month runway budget, interview 20 readers, ship weekly, and hold a written stop-loss: '
    + 'if I have no 500 subscribers by month 3, I return to part-time consulting.',
  category: 'Startup',
}

const CASE_DATA = { ...CASE_INPUT, docket: '#CASE-0000', ...analyzeCase(CASE_INPUT) }

const DEFENSES = [
  'I will cap spend at PHP 40,000 for the 6 month runway and review at week 12 with a written stop-loss.',
  'I will ask my partner to hold the pause trigger with me and schedule one non-negotiable rest day each week.',
  'I will test the wedge weekly with 20 interviews and a public build log so the audience compounds before competitors notice.',
]

// The evaluation the UI obtains from evaluateRebuttal, then hands to answer().
const evaluationFor = (trial, caseData, index) => {
  const persona = caseData.objections[trial.activeRound].persona
  return evaluateRebuttal({ rebuttal: DEFENSES[index], personaId: persona.id, signals: caseData.signals })
}

const answered = (trial, caseData, index) => answer(trial, {
  rebuttal: DEFENSES[index],
  caseData,
  evaluation: evaluationFor(trial, caseData, index),
})

test('makeTrial starts at round 0, in witness, with an empty record', () => {
  const trial = makeTrial(48)
  assert.deepEqual(trial, { activeRound: 0, score: 48, rebuttals: [], phase: 'witness', reaction: '' })
})

test('makeTrial keeps the score inside the canonical 0..100 contract', () => {
  assert.equal(makeTrial(-20).score, 0)
  assert.equal(makeTrial(500).score, 100)
  assert.equal(makeTrial(48).score, 48)
})

test('makeTrial carries no draft and no timer state', () => {
  const trial = makeTrial(48)
  // The textarea draft and the reveal pause are the UI's; the machine must not hold them.
  for (const key of ['currentRebuttal', 'pending', 'timer', 'screen']) {
    assert.equal(key in trial, false, `makeTrial must not own "${key}"`)
  }
})

test('answer records the rebuttal, accumulates the score and holds the reaction', () => {
  const trial = makeTrial(48)
  const evaluation = evaluationFor(trial, CASE_DATA, 0)
  const next = answer(trial, { rebuttal: DEFENSES[0], caseData: CASE_DATA, evaluation })

  assert.equal(next.rebuttals.length, 1)
  assert.deepEqual(next.rebuttals[0], {
    text: DEFENSES[0],
    delta: evaluation.delta,
    personaId: 'cfo',
    personaName: 'The Cynical CFO',
  })
  assert.equal(next.score, 48 + evaluation.delta)
  assert.equal(next.phase, 'reaction')
  assert.equal(next.reaction, evaluation.reaction)
  assert.equal(next.activeRound, 0, 'answering does not advance the round')
})

test('the answering Persona is derived from the round, so records stay in registry order', () => {
  let trial = makeTrial(40)
  for (let round = 0; round < 3; round++) {
    trial = answered(trial, CASE_DATA, round)
    trial = advance(trial, { caseData: CASE_DATA }).trial
  }
  assert.deepEqual(trial.rebuttals.map((r) => r.personaId), PERSONAS.map((p) => p.id))
  assert.deepEqual(trial.rebuttals.map((r) => r.personaName), PERSONAS.map((p) => p.name))
})

test('a round that has been answered refuses a second answer (double-submit guard)', () => {
  const trial = makeTrial(48)
  const once = answered(trial, CASE_DATA, 0)
  const twice = answered(once, CASE_DATA, 0)

  assert.equal(twice, once, 'a refused answer returns the trial unchanged')
  assert.equal(twice.rebuttals.length, 1)
  assert.equal(twice.score, once.score)
})

test('the score is clamped to 0..100 across the record', () => {
  const huge = { delta: 999, reaction: 'r', quality: 'substantial' }
  const tiny = { delta: -999, reaction: 'r', quality: 'insufficient' }

  const topped = answer(makeTrial(60), { rebuttal: 'x', caseData: CASE_DATA, evaluation: huge })
  assert.equal(topped.score, 100)

  const floored = answer(makeTrial(20), { rebuttal: 'x', caseData: CASE_DATA, evaluation: tiny })
  assert.equal(floored.score, 0)
})

test('advance opens the next round and clears the reaction', () => {
  const trial = answered(makeTrial(48), CASE_DATA, 0)
  const { trial: next, verdict } = advance(trial, { caseData: CASE_DATA })

  assert.equal(verdict, null, 'a non-terminal round produces no verdict')
  assert.equal(next.activeRound, 1)
  assert.equal(next.phase, 'witness')
  assert.equal(next.reaction, '')
  assert.equal(next.rebuttals.length, 1, 'the record survives the advance')
  assert.equal(next.score, trial.score)
})

test('advance on the last round seals the verdict from the record', () => {
  let trial = makeTrial(48)
  for (let round = 0; round < 3; round++) {
    trial = answered(trial, CASE_DATA, round)
    if (round < 2) trial = advance(trial, { caseData: CASE_DATA }).trial
  }
  assert.equal(trial.activeRound, 2)
  assert.equal(trial.rebuttals.length, 3)

  const { trial: after, verdict } = advance(trial, { caseData: CASE_DATA })
  assert.equal(after, trial, 'a finished trial is not advanced again')
  assert.ok(verdict)
  assert.equal(verdict.score, trial.score)
  assert.equal(verdict.strongestPersona, 'The Cynical CFO')
  assert.equal(verdict.prescriptions.length, 3)
})

test('a trial that has not been answered cannot advance (stale-caller guard)', () => {
  const fresh = makeTrial(48)
  assert.deepEqual(advance(fresh, { caseData: CASE_DATA }), { trial: fresh, verdict: null })

  // The shape an abandoned case leaves behind: a fresh trial can never produce a verdict.
  const abandoned = makeTrial(0)
  const { trial: after, verdict } = advance(abandoned, { caseData: CASE_DATA })
  assert.equal(verdict, null)
  assert.equal(after, abandoned)
})

test('advance is idempotent for a given round: a second call cannot re-advance or re-seal', () => {
  const answeredTrial = answered(makeTrial(48), CASE_DATA, 0)
  const first = advance(answeredTrial, { caseData: CASE_DATA })
  const second = advance(answeredTrial, { caseData: CASE_DATA })
  assert.deepEqual(first, second, 'the machine is pure — the same input yields the same transition')

  // After applying the first transition, the trial is no longer answered, so nothing advances.
  const third = advance(first.trial, { caseData: CASE_DATA })
  assert.equal(third.verdict, null)
  assert.equal(third.trial, first.trial)
})

test('the round cap derives from the objection count, not a literal', () => {
  const oneObjection = { ...CASE_DATA, objections: [CASE_DATA.objections[0]] }
  const trial = answer(makeTrial(48), { rebuttal: 'x', caseData: oneObjection, evaluation: { delta: 1, reaction: 'r' } })
  const { verdict } = advance(trial, { caseData: oneObjection })
  assert.ok(verdict, 'a single-objection case is terminal after its one round')
})

test('the machine is pure: it never mutates the trial it is given', () => {
  const trial = makeTrial(48)
  const snapshot = structuredClone(trial)
  answer(trial, { rebuttal: 'x', caseData: CASE_DATA, evaluation: { delta: 3, reaction: 'r' } })
  advance(answer(trial, { rebuttal: 'x', caseData: CASE_DATA, evaluation: { delta: 3, reaction: 'r' } }), { caseData: CASE_DATA })
  assert.deepEqual(trial, snapshot)
})
