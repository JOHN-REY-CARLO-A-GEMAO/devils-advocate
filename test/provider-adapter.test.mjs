// Group 4 + 5 of the card-1 test strategy: the provider adapter's acceptance tests.
//
// The frozen contract is that provider output is untrusted and that every outcome is either
//   A. a valid canonical CaseAnalysis, or
//   B. the deterministic engine's analysis (playable fallback).
// Every case below asserts one of those two, and each fallback is checked for playability by
// running it through createVerdict.
import test from 'node:test'
import assert from 'node:assert/strict'

import { PERSONAS, analyzeCase, createVerdict } from '../src/lib/courtroom.js'
import { translateProviderCase } from '../lib/courtroom.ts'

const CASE_INPUT = {
  title: 'Quit my job to build a niche newsletter',
  plan: 'I will keep a 6 month runway budget, interview 20 readers, ship weekly, and hold a written stop-loss: '
    + 'if I have no 500 subscribers by month 3, I return to part-time consulting.',
  category: 'Startup',
}

const ENVELOPE = { min: 18, max: 61 }
const CANONICAL_KEYS = ['initialScore', 'objections', 'signals']
const REGISTRY_ORDER = PERSONAS.map((persona) => persona.id)

const objection = (personaId, suffix = personaId) => ({
  personaId,
  text: `Provider objection from ${suffix}.`,
  pressure: `Provider pressure from ${suffix}.`,
})

const providerDraft = (overrides = {}) => ({
  initialScore: 44,
  objections: [objection('cfo'), objection('parent'), objection('competitor')],
  criticalBlindspot: 'Provider-authored blindspot prose.',
  prescriptions: ['Provider-authored prescription.'],
  provider: 'openai',
  ...overrides,
})

// ---- A / B verification helpers -------------------------------------------------

const assertCanonical = (result, input = CASE_INPUT) => {
  assert.deepEqual(Object.keys(result).sort(), CANONICAL_KEYS, 'not the canonical key set')
  assert.equal(result.objections.length, 3, 'not exactly three objections')
  assert.deepEqual(result.objections.map((o) => o.persona.id), REGISTRY_ORDER, 'not in registry order')
  assert.equal(Number.isInteger(result.initialScore), true, 'score is not an integer')
  assert.ok(
    result.initialScore >= ENVELOPE.min && result.initialScore <= ENVELOPE.max,
    `score ${result.initialScore} escaped the envelope`,
  )
  assert.deepEqual(result.signals, analyzeCase(input).signals, 'signals are not the engine signals')
  for (const entry of result.objections) {
    assert.equal(typeof entry.text, 'string')
    assert.ok(entry.text.length > 0)
    assert.equal(typeof entry.pressure, 'string')
    assert.ok(entry.pressure.length > 0)
  }
  // Playable: the canonical analysis must survive the verdict the UI renders.
  const verdict = createVerdict({ caseData: { ...input, ...result }, rebuttals: [], score: result.initialScore })
  assert.equal(verdict.prescriptions.length, 3)
  assert.ok(verdict.criticalBlindspot.title.length > 0)
  return result
}

const assertFallback = (result, input = CASE_INPUT) => {
  assert.deepEqual(result, analyzeCase(input), 'not the deterministic engine fallback')
  return assertCanonical(result, input)
}

// ---- the happy path -------------------------------------------------------------

test('a well-formed provider payload is translated into the canonical analysis', () => {
  const result = assertCanonical(translateProviderCase(CASE_INPUT, providerDraft()))

  assert.equal(result.initialScore, 44)
  assert.deepEqual(result.objections.map((o) => o.text), [
    'Provider objection from cfo.',
    'Provider objection from parent.',
    'Provider objection from competitor.',
  ])
  assert.deepEqual(result.objections.map((o) => o.pressure), [
    'Provider pressure from cfo.',
    'Provider pressure from parent.',
    'Provider pressure from competitor.',
  ])
})

test('provider fields outside the canonical contract never reach the analysis', () => {
  const result = translateProviderCase(CASE_INPUT, providerDraft())
  for (const key of ['provider', 'criticalBlindspot', 'prescriptions', 'persona', 'personaId']) {
    assert.equal(key in result, false, `leaked "${key}"`)
  }
})

test('a provider cannot supply Persona presentation', () => {
  const draft = providerDraft({
    objections: [
      { ...objection('cfo'), accent: '#000000', initials: 'XX', name: 'Injected', soft: 'rgba(0,0,0,1)' },
      objection('parent'),
      objection('competitor'),
    ],
  })
  const result = assertCanonical(translateProviderCase(CASE_INPUT, draft))

  assert.deepEqual(result.objections[0].persona, PERSONAS[0], 'the Persona came from the payload, not the registry')
  assert.equal(result.objections[0].persona.accent, PERSONAS[0].accent)
  assert.equal(result.objections[0].persona.initials, PERSONAS[0].initials)
})

test('objections are resolved to the registry entries themselves', () => {
  const result = assertCanonical(translateProviderCase(CASE_INPUT, providerDraft()))
  for (const [index, entry] of result.objections.entries()) {
    assert.equal(entry.persona, PERSONAS[index], 'the Objection must carry the registry entry')
  }
})

test('objection prose is trimmed', () => {
  const draft = providerDraft({
    objections: [
      { personaId: 'cfo', text: '  padded  ', pressure: '\n wrapped \n' },
      objection('parent'),
      objection('competitor'),
    ],
  })
  const result = assertCanonical(translateProviderCase(CASE_INPUT, draft))
  assert.equal(result.objections[0].text, 'padded')
  assert.equal(result.objections[0].pressure, 'wrapped')
})

test('the adapter does not mutate the payload it was given', () => {
  const draft = providerDraft()
  const before = structuredClone(draft)
  translateProviderCase(CASE_INPUT, draft)
  assert.deepEqual(draft, before)
})

// ---- score normalization --------------------------------------------------------

test('provider scores are normalized into the canonical envelope', () => {
  const cases = [
    [88, 61],
    [-500, 18],
    ['88', 61],
    [44, 44],
    ['44', 44],
    [44.6, 45],
    [18, 18],
    [61, 61],
    [0, 18],
    ['  52  ', 52],
    ['1e2', 61],
  ]
  for (const [supplied, expected] of cases) {
    const result = assertCanonical(translateProviderCase(CASE_INPUT, providerDraft({ initialScore: supplied })))
    assert.equal(result.initialScore, expected, `initialScore ${JSON.stringify(supplied)}`)
  }
})

test('an unusable score falls back to the engine start while keeping the objections', () => {
  const engineStart = analyzeCase(CASE_INPUT).initialScore
  for (const supplied of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 'eighty-eight', '', '   ', {}, [], true]) {
    const result = assertCanonical(translateProviderCase(CASE_INPUT, providerDraft({ initialScore: supplied })))
    assert.equal(result.initialScore, engineStart, `initialScore ${JSON.stringify(supplied)}`)
    assert.equal(result.objections[0].text, 'Provider objection from cfo.', 'provider objections were discarded')
  }
})

// ---- structural rejection: B, the deterministic fallback ------------------------

test('a payload that cannot be repaired falls back to the engine', () => {
  const cases = {
    'not an object (null)': null,
    'not an object (undefined)': undefined,
    'not an object (string)': 'provider said no',
    'not an object (number)': 42,
    'not an object (array)': [],
    'no objections field': providerDraft({ objections: undefined }),
    'objections not an array': providerDraft({ objections: 'three please' }),
    'too few objections': providerDraft({ objections: [objection('cfo'), objection('parent')] }),
    'too many objections': providerDraft({ objections: [...providerDraft().objections, objection('cfo')] }),
    'unknown personaId': providerDraft({ objections: [objection('cfo'), objection('parent'), objection('investor')] }),
    'duplicate personaId': providerDraft({ objections: [objection('cfo'), objection('cfo'), objection('competitor')] }),
    'missing personaId': providerDraft({ objections: [objection('cfo'), { text: 'x', pressure: 'y' }, objection('competitor')] }),
    'personaId not a string': providerDraft({ objections: [objection('cfo'), { personaId: 7, text: 'x', pressure: 'y' }, objection('competitor')] }),
    'null objection entry': providerDraft({ objections: [objection('cfo'), null, objection('competitor')] }),
    'string objection entry': providerDraft({ objections: [objection('cfo'), 'parent says no', objection('competitor')] }),
    'missing text': providerDraft({ objections: [objection('cfo'), { personaId: 'parent', pressure: 'y' }, objection('competitor')] }),
    'empty text': providerDraft({ objections: [objection('cfo'), { personaId: 'parent', text: '   ', pressure: 'y' }, objection('competitor')] }),
    'non-string text': providerDraft({ objections: [objection('cfo'), { personaId: 'parent', text: 12, pressure: 'y' }, objection('competitor')] }),
    'missing pressure': providerDraft({ objections: [objection('cfo'), { personaId: 'parent', text: 'x' }, objection('competitor')] }),
    'empty pressure': providerDraft({ objections: [objection('cfo'), { personaId: 'parent', text: 'x', pressure: '' }, objection('competitor')] }),
    'malformed objection shape': providerDraft({ objections: [objection('cfo'), { personaId: 'parent', text: { nested: true }, pressure: ['y'] }, objection('competitor')] }),
  }
  for (const [name, draft] of Object.entries(cases)) {
    assertFallback(translateProviderCase(CASE_INPUT, draft), CASE_INPUT)
    assert.equal(translateProviderCase(CASE_INPUT, draft).objections[0].persona.id, 'cfo', name)
  }
})

// ---- canonicalization: A, a valid canonical analysis ---------------------------

test('objections supplied out of registry order are re-ordered, not rejected', () => {
  const draft = providerDraft({
    objections: [objection('competitor'), objection('cfo'), objection('parent')],
  })
  const result = assertCanonical(translateProviderCase(CASE_INPUT, draft))

  assert.equal(result.objections[0].text, 'Provider objection from cfo.')
  assert.equal(result.objections[1].text, 'Provider objection from parent.')
  assert.equal(result.objections[2].text, 'Provider objection from competitor.')
})

test('malformed blindspot and prescription data is outside the contract and changes nothing', () => {
  const malformed = [
    { criticalBlindspot: 42, prescriptions: 'not a list' },
    { criticalBlindspot: null, prescriptions: [null, 7, {}] },
    { criticalBlindspot: { title: 'nested', body: 'object' }, prescriptions: [] },
  ]
  for (const overrides of malformed) {
    const result = assertCanonical(translateProviderCase(CASE_INPUT, providerDraft(overrides)))
    assert.equal(result.initialScore, 44)
    assert.equal(result.objections[0].text, 'Provider objection from cfo.')
  }
})

test('unknown extra fields are ignored', () => {
  const draft = providerDraft({ confidence: 0.9, notes: ['a', 'b'], persona: { id: 'injected' } })
  const result = assertCanonical(translateProviderCase(CASE_INPUT, draft))
  assert.deepEqual(Object.keys(result).sort(), CANONICAL_KEYS)
})

test('the adapter is deterministic across repeated calls', () => {
  const draft = providerDraft({ initialScore: 88 })
  const first = translateProviderCase(CASE_INPUT, draft)
  const second = translateProviderCase(CASE_INPUT, draft)
  assert.deepEqual(first, second)
  assert.equal(first.initialScore, 61)
})
