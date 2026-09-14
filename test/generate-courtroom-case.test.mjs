// Card 1, commit 3: the seam itself. generateCourtroomCase is exercised without a network by
// stubbing fetch, so both provider paths and every failure path are covered offline.
import test from 'node:test'
import assert from 'node:assert/strict'

import { analyzeCase } from '../src/lib/courtroom.js'
import { generateCourtroomCase } from '../lib/courtroom.ts'

const CASE_INPUT = {
  title: 'Quit my job to build a niche newsletter',
  plan: 'I will keep a 6 month runway budget, interview 20 readers, ship weekly, and hold a written stop-loss: '
    + 'if I have no 500 subscribers by month 3, I return to part-time consulting.',
  category: 'Startup',
}

const CANONICAL_KEYS = ['initialScore', 'objections', 'signals']
const PROVIDER_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']

const providerPayload = (overrides = {}) => ({
  initialScore: 88,
  objections: [
    { personaId: 'competitor', text: 'Provider competitor text.', pressure: 'Provider competitor pressure.' },
    { personaId: 'cfo', text: 'Provider cfo text.', pressure: 'Provider cfo pressure.' },
    { personaId: 'parent', text: 'Provider parent text.', pressure: 'Provider parent pressure.' },
  ],
  criticalBlindspot: 'Provider blindspot prose.',
  prescriptions: ['Provider prescription.'],
  ...overrides,
})

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body })
const openAiBody = (payload) => ({ choices: [{ message: { content: JSON.stringify(payload) } }] })
const anthropicBody = (payload) => ({ content: [{ text: JSON.stringify(payload) }] })

// Sets the provider env for one call and restores it afterwards.
async function withEnv(env, run) {
  const saved = Object.fromEntries(PROVIDER_KEYS.map((key) => [key, process.env[key]]))
  for (const key of PROVIDER_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  try {
    return await run()
  } finally {
    for (const key of PROVIDER_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

async function withFetch(handler, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return handler(url, options)
  }
  try {
    return await run(calls)
  } finally {
    globalThis.fetch = original
  }
}

test('without provider keys the seam returns the deterministic engine analysis', async () => {
  const result = await withEnv({}, () => generateCourtroomCase(CASE_INPUT))
  assert.deepEqual(result, analyzeCase(CASE_INPUT))
  assert.deepEqual(Object.keys(result).sort(), CANONICAL_KEYS)
})

test('a provider response is translated before it leaves the seam', async () => {
  const result = await withEnv({ OPENAI_API_KEY: 'test-key' }, () =>
    withFetch(() => jsonResponse(openAiBody(providerPayload())), async (calls) => {
      const analysis = await generateCourtroomCase(CASE_INPUT)
      assert.equal(calls.length, 1)
      assert.match(calls[0].url, /api\.openai\.com/)
      return analysis
    }))

  assert.deepEqual(Object.keys(result).sort(), CANONICAL_KEYS)
  assert.equal(result.initialScore, 61, 'provider score 88 must not escape the envelope')
  assert.deepEqual(result.objections.map((o) => o.persona.id), ['cfo', 'parent', 'competitor'])
  assert.deepEqual(result.objections.map((o) => o.text), [
    'Provider cfo text.',
    'Provider parent text.',
    'Provider competitor text.',
  ])
  assert.deepEqual(result.signals, analyzeCase(CASE_INPUT).signals)
})

test('the anthropic path is translated the same way', async () => {
  const result = await withEnv({ ANTHROPIC_API_KEY: 'test-key' }, () =>
    withFetch(() => jsonResponse(anthropicBody(providerPayload({ initialScore: -500 }))), async (calls) => {
      const analysis = await generateCourtroomCase(CASE_INPUT)
      assert.match(calls[0].url, /api\.anthropic\.com/)
      return analysis
    }))

  assert.deepEqual(Object.keys(result).sort(), CANONICAL_KEYS)
  assert.equal(result.initialScore, 18)
  assert.deepEqual(result.objections.map((o) => o.persona.id), ['cfo', 'parent', 'competitor'])
})

test('an unusable provider payload falls back to the engine rather than reaching a caller', async () => {
  const payloads = {
    'too few objections': providerPayload({ objections: providerPayload().objections.slice(0, 2) }),
    'unknown personaId': providerPayload({ objections: [{ personaId: 'investor', text: 'x', pressure: 'y' }] }),
    'not an object': 'the model declined',
  }
  for (const [name, payload] of Object.entries(payloads)) {
    const result = await withEnv({ OPENAI_API_KEY: 'test-key' }, () =>
      withFetch(() => jsonResponse(openAiBody(payload)), () => generateCourtroomCase(CASE_INPUT)))
    assert.deepEqual(result, analyzeCase(CASE_INPUT), name)
  }
})

test('a failed provider call falls back to the engine', async () => {
  const failures = {
    'http 500': () => jsonResponse({}, { ok: false, status: 500 }),
    'http 401': () => jsonResponse({}, { ok: false, status: 401 }),
    'non-JSON body': () => jsonResponse({ choices: [{ message: { content: 'not json' } }] }),
    'missing content': () => jsonResponse({ choices: [] }),
    'network error': () => { throw new Error('ECONNRESET') },
  }
  for (const [name, handler] of Object.entries(failures)) {
    const result = await withEnv({ OPENAI_API_KEY: 'test-key' }, () =>
      withFetch(handler, () => generateCourtroomCase(CASE_INPUT)))
    assert.deepEqual(result, analyzeCase(CASE_INPUT), name)
    assert.deepEqual(Object.keys(result).sort(), CANONICAL_KEYS, name)
  }
})

test('no provider-shaped field ever escapes the seam', async () => {
  const results = [
    await withEnv({}, () => generateCourtroomCase(CASE_INPUT)),
    await withEnv({ OPENAI_API_KEY: 'test-key' }, () =>
      withFetch(() => jsonResponse(openAiBody(providerPayload())), () => generateCourtroomCase(CASE_INPUT))),
  ]
  for (const result of results) {
    for (const key of ['provider', 'criticalBlindspot', 'prescriptions', 'personaId']) {
      assert.equal(key in result, false, `leaked "${key}"`)
    }
    assert.deepEqual(Object.keys(result).sort(), CANONICAL_KEYS)
  }
})
