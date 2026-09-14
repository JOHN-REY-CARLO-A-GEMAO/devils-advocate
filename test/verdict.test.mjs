// Group 3 of the card-1 test strategy: createVerdict behavior.
// The verdict is the only outcome the petitioner keeps, so its precedence rules and band
// boundaries are pinned here as observable behavior, not as implementation detail.
import test from 'node:test'
import assert from 'node:assert/strict'

import { analyzeCase, createVerdict } from '../src/lib/courtroom.js'

// Each case drives exactly one branch of the blindspot precedence by turning the four
// signals createVerdict reads (money, fallback, customer, moat) on and off in order.
const BLINDSPOT_FIXTURES = [
  { plan: 'no signals here', category: 'Relationship', expected: 'The unpriced downside' },
  { plan: 'budget of php 50000 with customers who are users and a newsletter', category: 'Startup', expected: 'The missing exit ramp' },
  { plan: 'budget of php 50000 and a written fallback stop trigger', category: 'Startup', expected: 'Unproven demand' },
  { plan: 'budget of php 50000, written fallback stop trigger, 20 customer interviews', category: 'Startup', expected: 'Copyability' },
  { plan: 'budget of php 50000, written fallback stop trigger, 20 customer interviews, a real moat and defensible brand', category: 'Startup', expected: 'Execution drag' },
]

function verdictFor(input, overrides = {}) {
  const analysis = analyzeCase(input)
  return createVerdict({
    caseData: { ...input, ...analysis },
    rebuttals: [],
    score: 50,
    ...overrides,
  })
}

test('the critical blindspot follows one precedence order', () => {
  for (const { plan, category, expected } of BLINDSPOT_FIXTURES) {
    const verdict = verdictFor({ title: 'T', plan, category })
    assert.equal(verdict.criticalBlindspot.title, expected, plan)
    assert.equal(typeof verdict.criticalBlindspot.body, 'string')
    assert.ok(verdict.criticalBlindspot.body.length > 0)
  }
})

test('the blindspot is always {title, body}, never a bare string', () => {
  const verdict = verdictFor({ title: 'T', plan: 'p', category: 'Startup' })
  assert.deepEqual(Object.keys(verdict.criticalBlindspot).sort(), ['body', 'title'])
})

test('prescriptions are always three, one per risk pair, in order', () => {
  for (const { plan, category } of BLINDSPOT_FIXTURES) {
    const { prescriptions } = verdictFor({ title: 'T', plan, category })
    assert.equal(prescriptions.length, 3)
    for (const item of prescriptions) {
      assert.equal(typeof item, 'string')
      assert.ok(item.length > 0)
    }
  }
})

test('the two band thresholds are 40 and 75, and they live in one place', () => {
  const input = { title: 'T', plan: 'p', category: 'Startup' }
  const analysis = analyzeCase(input)
  const caseData = { ...input, ...analysis }
  const bandAt = (score) => createVerdict({ caseData, rebuttals: [], score })

  assert.equal(bandAt(39.4).verdictType, 'convicted')
  assert.equal(bandAt(39.5).verdictType, 'probation')
  assert.equal(bandAt(74.4).verdictType, 'probation')
  assert.equal(bandAt(74.5).verdictType, 'acquitted')
})

test('verdict labels are stable per band', () => {
  const input = { title: 'T', plan: 'p', category: 'Startup' }
  const caseData = { ...input, ...analyzeCase(input) }
  const labelAt = (score) => createVerdict({ caseData, rebuttals: [], score }).verdictLabel

  assert.equal(labelAt(0), 'CONVICTED OF DELUSION')
  assert.equal(labelAt(50), 'PROBATIONARY RISK')
  assert.equal(labelAt(100), 'STRESS-TESTED & ACQUITTED')
})

test('the strongest defense is the highest-delta rebuttal', () => {
  const input = { title: 'T', plan: 'p', category: 'Startup' }
  const caseData = { ...input, ...analyzeCase(input) }
  const verdict = createVerdict({
    caseData,
    score: 50,
    rebuttals: [
      { text: 'low', delta: 3, personaId: 'parent', personaName: 'The Disappointed Parent' },
      { text: 'high', delta: 9, personaId: 'cfo', personaName: 'The Cynical CFO' },
      { text: 'mid', delta: -2, personaId: 'competitor', personaName: 'The Paranoid Competitor' },
    ],
  })
  assert.equal(verdict.strongestDefense, 'high')
  assert.equal(verdict.strongestPersona, 'The Cynical CFO')
})

test('an empty record produces the documented fallback text', () => {
  const verdict = verdictFor({ title: 'T', plan: 'p', category: 'Startup' })
  assert.equal(verdict.strongestDefense, 'No rebuttal was entered into the record.')
  assert.equal(verdict.strongestPersona, 'the record')
})

test('the verdict carries the canonical fields the UI and PDF read', () => {
  const verdict = verdictFor({ title: 'T', plan: 'p', category: 'Startup' })
  for (const field of ['score', 'verdictType', 'verdictLabel', 'criticalBlindspot', 'strongestDefense', 'strongestPersona', 'prescriptions']) {
    assert.ok(field in verdict, `verdict is missing ${field}`)
  }
  assert.ok(['convicted', 'probation', 'acquitted'].includes(verdict.verdictType))
})

// The frozen card-1 contract routes every provider payload through the adapter, so
// createVerdict only ever sees a canonical CaseAnalysis. This test pins today's failure mode
// (a TypeError from deep inside) so that the guard cannot silently regress into producing an
// unusable verdict. A typed error is a separate decision, deliberately not taken here.
test('malformed caseData fails loudly rather than producing an unusable verdict', () => {
  assert.throws(() => createVerdict({ caseData: {}, rebuttals: [], score: 50 }), TypeError)
})
