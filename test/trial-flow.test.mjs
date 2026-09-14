// Group 6 of the card-1 test strategy, re-pointed at Card 2's real trial machine.
//
// This file used to re-implement the run loop, including its own score clamp, which meant the
// suite verified a copy that could drift from the app. It now drives makeTrial / answer /
// advance from src/lib/courtroom.js — the same functions the UI calls — and keeps the original
// end-to-end assertions on the observable outcome.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PERSONAS,
  advance,
  analyzeCase,
  answer,
  evaluateRebuttal,
  getCaseNumber,
  makeTrial,
} from '../src/lib/courtroom.js'

const FORM = {
  title: 'Quit my job to build a niche newsletter',
  plan: 'I will keep a 6 month runway budget, interview 20 readers, ship weekly, and hold a written stop-loss: '
    + 'if I have no 500 subscribers by month 3, I return to part-time consulting.',
  category: 'Startup',
}

const DEFENSES = [
  'I will cap spend at PHP 40,000 for the 6 month runway and review at week 12 with a written stop-loss.',
  'I will ask my partner to hold the pause trigger with me and schedule one non-negotiable rest day each week.',
  'I will test the wedge weekly with 20 interviews and a public build log so the audience compounds before competitors notice.',
]

// The loop the UI runs: answer the round on the stand, then advance it once the reveal pause is
// over. No timers here — the pause is presentation and the machine does not own it.
function playFullTrial(form = FORM, defenses = DEFENSES) {
  const analysis = analyzeCase(form)
  const caseFile = { ...form, title: form.title.trim(), plan: form.plan.trim(), docket: getCaseNumber(), ...analysis }
  let trial = makeTrial(analysis.initialScore)
  const evaluations = []
  let verdict = null

  for (const [round, { persona }] of caseFile.objections.entries()) {
    const evaluation = evaluateRebuttal({ rebuttal: defenses[round], personaId: persona.id, signals: caseFile.signals })
    evaluations.push(evaluation)
    trial = answer(trial, { rebuttal: defenses[round], caseData: caseFile, evaluation })
    const step = advance(trial, { caseData: caseFile })
    verdict = step.verdict
    trial = step.verdict ? trial : step.trial
  }

  return { caseFile, trial, evaluations, verdict }
}

test('a full trial on the engine path reaches a coherent verdict', () => {
  const { caseFile, trial, verdict } = playFullTrial()

  assert.equal(caseFile.objections.length, 3)
  assert.deepEqual(caseFile.objections.map((o) => o.persona.id), ['cfo', 'parent', 'competitor'])
  assert.equal(caseFile.initialScore, 48, 'the engine start point for this case')

  assert.equal(trial.activeRound, 2, 'the trial ends on the last round')
  assert.equal(trial.rebuttals.length, 3)
  assert.deepEqual(trial.rebuttals.map((r) => r.personaId), ['cfo', 'parent', 'competitor'])
  assert.deepEqual(trial.rebuttals.map((r) => r.delta), [9, 9, 9])
  assert.equal(trial.score, 75)

  assert.equal(verdict.score, 75)
  assert.equal(verdict.verdictType, 'acquitted')
  assert.equal(verdict.verdictLabel, 'STRESS-TESTED & ACQUITTED')
  assert.equal(verdict.criticalBlindspot.title, 'Copyability')
  assert.equal(verdict.prescriptions.length, 3)
  assert.equal(verdict.strongestDefense, DEFENSES[0])
  assert.equal(verdict.strongestPersona, 'The Cynical CFO')
})

test('every round produces a scored evaluation for the persona on the stand', () => {
  const { caseFile, evaluations } = playFullTrial()
  assert.equal(evaluations.length, 3)
  for (const [round, evaluation] of evaluations.entries()) {
    assert.equal(typeof evaluation.delta, 'number')
    assert.ok(['substantial', 'credible', 'thin', 'insufficient'].includes(evaluation.quality), `round ${round + 1}`)
    assert.match(evaluation.reaction, /./)
    assert.equal(caseFile.objections[round].persona.id, PERSONAS[round].id)
  }
})

test('the same case and the same defenses always produce the same verdict', () => {
  const first = playFullTrial()
  const second = playFullTrial()
  assert.equal(first.trial.score, second.trial.score)
  assert.deepEqual(first.trial.rebuttals, second.trial.rebuttals)
  assert.deepEqual(first.verdict.prescriptions, second.verdict.prescriptions)
})

// The form blocks an empty defense, but the machine still has to define what one does: it
// records the evaluation it is handed, so a zero-delta answer leaves the score where it was.
test('zero-delta defenses leave the score and still reach a verdict', () => {
  const { trial, verdict } = playFullTrial(FORM, ['', '', ''])
  assert.deepEqual(trial.rebuttals.map((r) => r.delta), [0, 0, 0])
  assert.equal(trial.score, 48)
  assert.ok(verdict.score >= 0 && verdict.score <= 100)
  assert.ok(['convicted', 'probation', 'acquitted'].includes(verdict.verdictType))
  assert.equal(verdict.prescriptions.length, 3)
})
