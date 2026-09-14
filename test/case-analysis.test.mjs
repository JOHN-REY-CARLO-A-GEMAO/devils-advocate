// Group 1 of the card-1 test strategy: the canonical input contract of the analysis interface.
// These tests describe what src/lib/courtroom.js guarantees to every caller, and — just as
// importantly — what it does not guarantee (see the intake test at the bottom).
//
// Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'

import { PERSONAS, analyzeCase } from '../src/lib/courtroom.js'

const CASE_INPUT = {
  title: 'Quit my job to build a niche newsletter',
  plan: 'I will keep a 6 month runway budget, interview 20 readers, ship weekly, and hold a written stop-loss: '
    + 'if I have no 500 subscribers by month 3, I return to part-time consulting.',
  category: 'Startup',
}

const CANONICAL_ANALYSIS_KEYS = ['initialScore', 'objections', 'signals']

const SIGNAL_FIELDS = [
  'hasMoney', 'hasTimeline', 'hasFallback', 'hasCustomer', 'hasDistribution',
  'hasMoat', 'hasSupport', 'hasRiskAcknowledgement', 'category', 'planWords',
  'titleWords', 'specificity',
]

const PERSONA_PRESENTATION_FIELDS = ['id', 'name', 'shortName', 'title', 'color', 'initials', 'accent', 'soft']

// Keys that must never appear on a CaseAnalysis: main.jsx spreads the analysis into the case
// file after the trimmed intake facts, so any of these would silently shadow the petitioner's input.
const RESERVED_INTAKE_KEYS = ['title', 'plan', 'category', 'docket']

test('analyzeCase returns exactly the canonical CaseAnalysis keys', () => {
  const analysis = analyzeCase(CASE_INPUT)
  assert.deepEqual(Object.keys(analysis).sort(), CANONICAL_ANALYSIS_KEYS)
})

test('analyzeCase never returns a key that could shadow the intake facts', () => {
  const analysis = analyzeCase(CASE_INPUT)
  for (const key of RESERVED_INTAKE_KEYS) {
    assert.equal(key in analysis, false, `CaseAnalysis must not carry "${key}"`)
  }
  // signals legitimately carries the category, but as analysis output, not as intake.
  assert.equal(analysis.signals.category, CASE_INPUT.category)
})

test('CaseAnalysis carries exactly three objections, one per Persona, in registry order', () => {
  const { objections } = analyzeCase(CASE_INPUT)
  assert.equal(objections.length, 3)
  assert.deepEqual(objections.map((o) => o.persona.id), PERSONAS.map((p) => p.id))
})

test('each Objection is {persona, text, pressure} and carries the resolved Persona', () => {
  const { objections } = analyzeCase(CASE_INPUT)
  for (const [index, objection] of objections.entries()) {
    assert.deepEqual(Object.keys(objection).sort(), ['persona', 'pressure', 'text'])
    assert.deepEqual(objection.persona, PERSONAS[index], 'the Objection carries the registry entry itself')
    assert.equal(typeof objection.text, 'string')
    assert.ok(objection.text.length > 0)
    assert.equal(typeof objection.pressure, 'string')
    assert.ok(objection.pressure.length > 0)
  }
})

test('the resolved Persona carries every presentation field the UI reads', () => {
  const { objections } = analyzeCase(CASE_INPUT)
  for (const { persona } of objections) {
    assert.deepEqual(Object.keys(persona).sort(), [...PERSONA_PRESENTATION_FIELDS].sort())
    assert.match(persona.accent, /^#[0-9a-f]{6}$/i)
    assert.ok(persona.soft.startsWith('rgba('))
  }
})

test('signals carry the documented engine fields with the documented types', () => {
  const { signals } = analyzeCase(CASE_INPUT)
  assert.deepEqual(Object.keys(signals).sort(), [...SIGNAL_FIELDS].sort())
  for (const field of SIGNAL_FIELDS.filter((name) => name.startsWith('has'))) {
    assert.equal(typeof signals[field], 'boolean', field)
  }
  for (const field of ['planWords', 'titleWords', 'specificity']) {
    assert.equal(Number.isInteger(signals[field]), true, field)
  }
  assert.equal(signals.category, CASE_INPUT.category)
})

// Known gap, recorded by the card-1 investigation: intake rules (title <= 120 chars,
// plan >= 12 words) live in the docket form, not in the domain module. A server-driven or
// scripted intake path can therefore build a Case the UI would have rejected. This is
// deliberately NOT fixed here — the frozen card-1 contract does not cover intake validation.
test('intake rules are enforced by the UI, not by the domain module (known gap)', () => {
  const analysis = analyzeCase({ title: '', plan: 'x', category: 'Startup' })
  assert.deepEqual(Object.keys(analysis).sort(), CANONICAL_ANALYSIS_KEYS)
  assert.equal(analysis.objections.length, 3)
})
