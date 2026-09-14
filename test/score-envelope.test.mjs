// Group 2 of the card-1 test strategy: score normalization and the score envelopes.
// The canonical contract says the trial starts inside the engine's envelope (18..61) and that
// every score on the record is clamped to 0..100 before banding. These tests pin both.
import test from 'node:test'
import assert from 'node:assert/strict'

import { evaluateRebuttal, analyzeCase, createVerdict, INITIAL_SCORE_RANGE } from '../src/lib/courtroom.js'

const CATEGORIES = ['Career', 'Startup', 'Financial', 'Relocation', 'Relationship']

const PLAN_SHAPES = {
  empty: '',
  moneyOnly: 'budget php $ runway savings revenue salary cost price income profit',
  allSignals: 'budget php $ runway week month deadline fallback worst-case exit plan b customer audience user '
    + 'client waitlist validation distribution channel sales partner community newsletter moat defensib patent '
    + 'unique advantage risk downside assumption ' + Array(90).fill('word').join(' '),
}

// The canonical starting envelope, owned by the engine and now exported so the provider
// adapter normalizes against the same numbers rather than its own copy.
const ENVELOPE = { min: 18, max: 61 }

test('the canonical starting envelope is exported from the domain module', () => {
  assert.deepEqual(INITIAL_SCORE_RANGE, ENVELOPE)
})

test('initialScore stays inside the canonical envelope for every category and plan shape', () => {
  for (const category of CATEGORIES) {
    for (const [shape, plan] of Object.entries(PLAN_SHAPES)) {
      const { initialScore } = analyzeCase({ title: 'T', plan, category })
      assert.ok(
        initialScore >= ENVELOPE.min && initialScore <= ENVELOPE.max,
        `${category}/${shape} produced ${initialScore}`,
      )
      assert.equal(Number.isInteger(initialScore), true, `${category}/${shape} is not an integer`)
    }
  }
})

test('the engine never starts a trial outside the envelope, so banding cannot be pre-decided', () => {
  // A start at 75+ would put a case in BATTLE-TESTED before the first objection; 18 keeps room
  // to climb. Both bounds are inside the known-good range of the 40/75 bands.
  for (const category of CATEGORIES) {
    const { initialScore } = analyzeCase({ title: 'T', plan: PLAN_SHAPES.allSignals, category })
    assert.ok(initialScore < 75, `${category} starts already acquitted at ${initialScore}`)
    assert.ok(initialScore > 0, `${category} starts below zero`)
  }
})

test('rebuttal deltas stay inside their envelope (-5..13)', () => {
  const rebuttals = {
    denialWithoutActionWords: 'nothing can go wrong, figure it out later',
    denialWithActionWords: 'just trust me it will work, nothing can go wrong, i know it will, figure it out later',
    empty: '',
    strongEvidence: 'I will cap the budget at PHP 40,000, will track the metric weekly, test with 12 customer '
      + 'interviews, set a deadline of 8 week, partner review, contract evidence, data threshold, stop fallback, '
      + Array(60).fill('plan').join(' '),
  }
  for (const [name, rebuttal] of Object.entries(rebuttals)) {
    const { delta } = evaluateRebuttal({ rebuttal, personaId: 'cfo' })
    assert.ok(delta >= -5 && delta <= 13, `${name} produced ${delta}`)
    assert.equal(Number.isInteger(delta), true, `${name} is not an integer`)
  }
})

test('the verdict score is clamped to 0..100 and rounded before banding', () => {
  const caseFile = { ...analyzeCase({ title: 'T', plan: 'p', category: 'Startup' }), title: 'T', category: 'Startup' }
  for (const [raw, expected] of [[-20, 0], [0, 0], [39.4, 39], [39.5, 40], [74.5, 75], [100, 100], [500, 100]]) {
    const { score } = createVerdict({ caseData: caseFile, rebuttals: [], score: raw })
    assert.equal(score, expected, `raw ${raw}`)
    assert.equal(Number.isInteger(score), true)
  }
})
