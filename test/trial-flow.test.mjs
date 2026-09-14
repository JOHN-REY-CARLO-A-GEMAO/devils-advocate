// Group 6 of the card-1 test strategy: the end-to-end regression anchor.
// This mirrors App.startTrial -> App.submitRebuttal x3 -> createVerdict exactly as src/main.jsx
// does it, and asserts the observable outcome. It is the anchor that the provider adapter must
// not disturb: the engine path is the reference implementation of the canonical contract.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzeCase,
  createVerdict,
  evaluateRebuttal,
  getCaseNumber,
} from '../src/lib/courtroom.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

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

// The same sequence main.jsx runs, with no DOM involved.
function runTrial(form = FORM, defenses = DEFENSES) {
  const analysis = analyzeCase(form)
  const caseFile = { ...form, title: form.title.trim(), plan: form.plan.trim(), docket: getCaseNumber(), ...analysis }
  let score = analysis.initialScore
  const rebuttals = []
  const evaluations = []
  for (const [round, defense] of defenses.entries()) {
    const { persona } = caseFile.objections[round]
    const evaluation = evaluateRebuttal({ rebuttal: defense, personaId: persona.id, signals: caseFile.signals })
    evaluations.push(evaluation)
    rebuttals.push({ text: defense, delta: evaluation.delta, personaId: persona.id, personaName: persona.name })
    score = clamp(score + evaluation.delta, 0, 100)
  }
  return { caseFile, rebuttals, evaluations, score, verdict: createVerdict({ caseData: caseFile, rebuttals, score }) }
}

test('a full trial on the engine path reaches a coherent verdict', () => {
  const { caseFile, rebuttals, score, verdict } = runTrial()

  assert.equal(caseFile.objections.length, 3)
  assert.deepEqual(caseFile.objections.map((o) => o.persona.id), ['cfo', 'parent', 'competitor'])
  assert.equal(caseFile.initialScore, 48, 'the engine start point for this case')
  assert.deepEqual(rebuttals.map((r) => r.personaId), ['cfo', 'parent', 'competitor'])
  assert.deepEqual(rebuttals.map((r) => r.delta), [9, 9, 9])
  assert.equal(score, 75)

  assert.equal(verdict.score, 75)
  assert.equal(verdict.verdictType, 'acquitted')
  assert.equal(verdict.verdictLabel, 'STRESS-TESTED & ACQUITTED')
  assert.equal(verdict.criticalBlindspot.title, 'Copyability')
  assert.equal(verdict.prescriptions.length, 3)
  assert.equal(verdict.strongestDefense, DEFENSES[0])
  assert.equal(verdict.strongestPersona, 'The Cynical CFO')
})

test('every round produces a scored evaluation for the persona on the stand', () => {
  const { caseFile, evaluations } = runTrial()
  assert.equal(evaluations.length, 3)
  for (const [round, evaluation] of evaluations.entries()) {
    assert.equal(typeof evaluation.delta, 'number')
    assert.ok(['substantial', 'credible', 'thin', 'insufficient'].includes(evaluation.quality), `round ${round + 1}`)
    assert.match(evaluation.reaction, /./)
    assert.equal(caseFile.objections[round].persona.id, `${['cfo', 'parent', 'competitor'][round]}`)
  }
})

test('the same case and the same defenses always produce the same verdict', () => {
  const first = runTrial()
  const second = runTrial()
  assert.equal(first.score, second.score)
  assert.deepEqual(first.rebuttals, second.rebuttals)
  assert.deepEqual(first.verdict.prescriptions, second.verdict.prescriptions)
})

// The form blocks an empty defense, but the domain still has to define what one scores.
test('the domain tolerates zero-delta defenses without losing the verdict', () => {
  const { rebuttals, verdict } = runTrial(FORM, ['', '', ''])
  assert.deepEqual(rebuttals.map((r) => r.delta), [0, 0, 0])
  assert.ok(verdict.score >= 0 && verdict.score <= 100)
  assert.ok(['convicted', 'probation', 'acquitted'].includes(verdict.verdictType))
  assert.equal(verdict.prescriptions.length, 3)
})
