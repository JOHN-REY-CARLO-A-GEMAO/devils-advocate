// Card 3: the survivability band has one owner — classifyBand in src/lib/courtroom.js.
// These tests pin the thresholds, the canonical value contract, and the fact that every
// classification surface agrees for every score. Human-facing vocabulary is deliberately NOT
// asserted here: the trial gauge and the sealed Verdict use different words by design.
import test from 'node:test'
import assert from 'node:assert/strict'

import { analyzeCase, classifyBand, createVerdict } from '../src/lib/courtroom.js'

const CANONICAL_BANDS = ['convicted', 'probation', 'acquitted']
const CASE_INPUT = { title: 'T', plan: 'p', category: 'Startup' }
const CASE_DATA = { ...CASE_INPUT, ...analyzeCase(CASE_INPUT) }

const verdictFor = (score) => createVerdict({ caseData: CASE_DATA, rebuttals: [], score })

test('classifyBand maps the canonical thresholds', () => {
  const cases = [
    [0, 'convicted'],
    [39, 'convicted'],
    [40, 'probation'],
    [41, 'probation'],
    [74, 'probation'],
    [75, 'acquitted'],
    [76, 'acquitted'],
    [100, 'acquitted'],
  ]
  for (const [score, band] of cases) {
    assert.equal(classifyBand(score), band, `score ${score}`)
  }
})

test('the band values are the canonical external contract', () => {
  // 'probation' is the value; "probationary" is prose. Renaming it breaks the analytics
  // payload (verdict_type) and the data-verdict-type attribute.
  assert.equal(classifyBand(50), 'probation')
  assert.equal(classifyBand(39), 'convicted')
  assert.equal(classifyBand(75), 'acquitted')
  assert.ok(!CANONICAL_BANDS.includes('probationary'))
})

test('scores outside 0..100 keep the band they would have after clamping', () => {
  assert.equal(classifyBand(-5), 'convicted')
  assert.equal(classifyBand(500), 'acquitted')
})

test('createVerdict and classifyBand agree for every integer score in 0..100', () => {
  for (let score = 0; score <= 100; score++) {
    const verdict = verdictFor(score)
    assert.equal(verdict.score, score, `score ${score} was altered`)
    assert.equal(verdict.verdictType, classifyBand(score), `score ${score} disagrees between the verdict and the band rule`)
  }
})

test('every band has exactly one canonical sealed label', () => {
  const labels = new Set()
  for (let score = 0; score <= 100; score++) {
    const { verdictLabel } = verdictFor(score)
    assert.equal(typeof verdictLabel, 'string')
    assert.ok(verdictLabel.length > 0, `score ${score} has no label`)
    labels.add(verdictLabel)
  }
  assert.deepEqual([...labels].sort(), ['CONVICTED OF DELUSION', 'PROBATIONARY RISK', 'STRESS-TESTED & ACQUITTED'])
})

// The band rule assumes the canonical score. createVerdict normalizes (rounds, then clamps)
// BEFORE classifying, which is why a raw 39.5 lands in the 40 band.
test('classification happens downstream of score normalization', () => {
  assert.equal(verdictFor(39.4).verdictType, 'convicted')
  assert.equal(verdictFor(39.5).verdictType, 'probation')
  assert.equal(verdictFor(39.6).verdictType, 'probation')
  assert.equal(verdictFor(40).verdictType, 'probation')
  assert.equal(verdictFor(74.4).verdictType, 'probation')
  assert.equal(verdictFor(74.5).verdictType, 'acquitted')
  assert.equal(verdictFor(74.6).verdictType, 'acquitted')
  assert.equal(verdictFor(75).verdictType, 'acquitted')
})

test('the band rule owns the thresholds, not the presentation', () => {
  // Guard against presentation creeping back into the domain rule: the return value is one of
  // three band values, and nothing else.
  for (let score = 0; score <= 100; score++) {
    assert.ok(CANONICAL_BANDS.includes(classifyBand(score)), `score ${score} returned an unknown band`)
  }
})
