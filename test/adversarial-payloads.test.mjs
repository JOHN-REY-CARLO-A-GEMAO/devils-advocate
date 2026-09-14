// Card 1, commit 4: the adversarial payload matrix from the frozen contract, run end-to-end
// through the seam with a stubbed fetch.
//
// Every payload must land on exactly one of two paths:
//   A. a valid canonical CaseAnalysis, or
//   B. the deterministic engine's analysis (playable fallback).
// Nothing else is acceptable, and every result must survive createVerdict.
import test from 'node:test'
import assert from 'node:assert/strict'

import { PERSONAS, analyzeCase, createVerdict } from '../src/lib/courtroom.js'
import { translateProviderCase, generateCourtroomCase } from '../lib/courtroom.ts'

const CASE_INPUT = {
  title: 'Quit my job to build a niche newsletter',
  plan: 'I will keep a 6 month runway budget, interview 20 readers, ship weekly, and hold a written stop-loss: '
    + 'if I have no 500 subscribers by month 3, I return to part-time consulting.',
  category: 'Startup',
}

const CANONICAL_KEYS = ['initialScore', 'objections', 'signals']
const REGISTRY_ORDER = PERSONAS.map((persona) => persona.id)

const objection = (personaId) => ({ personaId, text: `${personaId} text`, pressure: `${personaId} pressure` })
const validObjections = () => [objection('cfo'), objection('parent'), objection('competitor')]

const payload = (overrides = {}) => ({
  initialScore: 44,
  objections: validObjections(),
  criticalBlindspot: 'blindspot prose',
  prescriptions: ['prescription'],
  ...overrides,
})

// A: canonical, or B: fallback — asserted structurally, never by reading internals.
function assertPath(result, expectation, name) {
  assert.deepEqual(Object.keys(result).sort(), CANONICAL_KEYS, `${name}: wrong key set`)
  assert.equal(result.objections.length, 3, `${name}: wrong objection count`)
  assert.deepEqual(result.objections.map((o) => o.persona.id), REGISTRY_ORDER, `${name}: wrong persona order`)
  assert.ok(result.initialScore >= 18 && result.initialScore <= 61, `${name}: score outside the envelope`)
  assert.deepEqual(result.signals, analyzeCase(CASE_INPUT).signals, `${name}: signals are not the engine's`)

  if (expectation === 'B') {
    assert.deepEqual(result, analyzeCase(CASE_INPUT), `${name}: expected the deterministic engine fallback`)
  } else {
    assert.notDeepEqual(result, analyzeCase(CASE_INPUT), `${name}: expected provider content, got the fallback`)
  }

  // Playable either way.
  const verdict = createVerdict({ caseData: { ...CASE_INPUT, ...result }, rebuttals: [], score: result.initialScore })
  assert.ok(verdict.verdictType, `${name}: no verdict`)
  assert.equal(verdict.prescriptions.length, 3, `${name}: verdict is not playable`)
  return result
}

const MATRIX = [
  { name: 'initialScore 88', expectation: 'A', draft: payload({ initialScore: 88 }), score: 61 },
  { name: 'initialScore -500', expectation: 'A', draft: payload({ initialScore: -500 }), score: 18 },
  { name: 'initialScore "88"', expectation: 'A', draft: payload({ initialScore: '88' }), score: 61 },
  { name: 'unknown personaId', expectation: 'B', draft: payload({ objections: [objection('cfo'), objection('parent'), objection('investor')] }) },
  { name: 'missing personaId', expectation: 'B', draft: payload({ objections: [objection('cfo'), { text: 'x', pressure: 'y' }, objection('competitor')] }) },
  { name: 'duplicate personaId', expectation: 'B', draft: payload({ objections: [objection('cfo'), objection('cfo'), objection('competitor')] }) },
  { name: 'wrong objection count (2)', expectation: 'B', draft: payload({ objections: validObjections().slice(0, 2) }) },
  { name: 'wrong objection count (4)', expectation: 'B', draft: payload({ objections: [...validObjections(), objection('cfo')] }) },
  { name: 'wrong objection order', expectation: 'A', draft: payload({ objections: [objection('competitor'), objection('cfo'), objection('parent')] }) },
  { name: 'malformed objection (missing text)', expectation: 'B', draft: payload({ objections: [objection('cfo'), { personaId: 'parent', pressure: 'y' }, objection('competitor')] }) },
  { name: 'malformed objection (null entry)', expectation: 'B', draft: payload({ objections: [objection('cfo'), null, objection('competitor')] }) },
  { name: 'malformed objection (numeric text)', expectation: 'B', draft: payload({ objections: [objection('cfo'), { personaId: 'parent', text: 12, pressure: 'y' }, objection('competitor')] }) },
  { name: 'malformed blindspot data', expectation: 'A', draft: payload({ criticalBlindspot: 42 }) },
  { name: 'malformed prescription data', expectation: 'A', draft: payload({ prescriptions: 'not a list' }) },
  { name: 'malformed blindspot + prescriptions', expectation: 'A', draft: payload({ criticalBlindspot: null, prescriptions: [null, 7] }) },
  { name: 'not an object at all', expectation: 'B', draft: 'the model declined' },
]

// --- the seam (generateCourtroomCase) is the surface that actually faces a caller ---------

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body })

async function throughSeam(draft) {
  const savedKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({ choices: [{ message: { content: typeof draft === 'string' ? draft : JSON.stringify(draft) } }] })
  try {
    return await generateCourtroomCase(CASE_INPUT)
  } finally {
    globalThis.fetch = savedFetch
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = savedKey
  }
}

for (const { name, expectation, draft, score } of MATRIX) {
  test(`[adapter] ${name} -> path ${expectation}`, () => {
    const result = assertPath(translateProviderCase(CASE_INPUT, draft), expectation, name)
    if (score !== undefined) assert.equal(result.initialScore, score, name)
  })

  test(`[seam] ${name} -> path ${expectation}`, async () => {
    const result = assertPath(await throughSeam(draft), expectation, name)
    if (score !== undefined) assert.equal(result.initialScore, score, name)
  })
}

test('the matrix covers every path: canonical content and fallback both occur', () => {
  assert.equal(MATRIX.filter((entry) => entry.expectation === 'A').length, 7)
  assert.equal(MATRIX.filter((entry) => entry.expectation === 'B').length, 9)
})
