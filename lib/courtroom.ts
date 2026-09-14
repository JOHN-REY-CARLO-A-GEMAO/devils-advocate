/**
 * Server-side AI seam for the pre-mortem engine.
 *
 * This file is intentionally not imported by the browser bundle. Wire it to a
 * Next.js route, edge function, or your own server and keep OPENAI_API_KEY /
 * ANTHROPIC_API_KEY in server-only environment variables.
 *
 * Provider output is untrusted. Nothing downstream ever sees it: it is translated into the
 * canonical CaseAnalysis owned by src/lib/courtroom.js before it leaves this seam.
 */

import { INITIAL_SCORE_RANGE, PERSONAS, analyzeCase } from '../src/lib/courtroom.js'

export type RiskCategory = 'Career' | 'Startup' | 'Financial' | 'Relocation' | 'Relationship'
export type CaseInput = { title: string; plan: string; category: RiskCategory }
export type Provider = 'openai' | 'anthropic' | 'mock'

/**
 * The canonical shapes are owned by src/lib/courtroom.js. They are declared narrowly here so
 * this seam can type its output without becoming a second owner of the domain model.
 */
export type CanonicalObjection = {
  /** The resolved Persona registry entry — never a provider-supplied object. */
  persona: Record<string, unknown>
  text: string
  pressure: string
}

export type CanonicalCaseAnalysis = {
  /** Engine-owned signal bag. Opaque at this seam: the adapter passes it through untouched. */
  signals: Record<string, unknown>
  initialScore: number
  objections: CanonicalObjection[]
}

const SYSTEM_PROMPT = `You are an adversarial pre-mortem courtroom. Return valid JSON only.
Analyze the user's decision through three distinct critics, one per personaId:
'cfo' (The Cynical CFO), 'parent' (The Disappointed Parent), 'competitor' (The Paranoid Competitor).
Return {initialScore:number, objections:[{personaId:'cfo'|'parent'|'competitor',text:string,pressure:string}],
criticalBlindspot:string, prescriptions:string[]} with exactly three objections.
Be specific to the case, direct but useful, and never invent facts.`

async function askOpenAI(input: CaseInput, apiKey: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.7, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(input) }] }),
  })
  if (!response.ok) throw new Error(`OpenAI request failed with ${response.status}`)
  return JSON.parse((await response.json()).choices[0].message.content)
}

async function askAnthropic(input: CaseInput, apiKey: string) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-3-5-haiku-latest', max_tokens: 1100, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: JSON.stringify(input) }] }),
  })
  if (!response.ok) throw new Error(`Anthropic request failed with ${response.status}`)
  const payload = await response.json()
  return JSON.parse(payload.content?.[0]?.text ?? '{}')
}

// ---------------------------------------------------------------------------
// Provider adapter: provider payload -> canonical CaseAnalysis
//
// A provider may supply objection text/pressure, one personaId per objection, and an
// initial score. It may not supply Persona presentation, change the objection count or
// order, or escape the canonical starting envelope. Anything else is either normalized
// away or rejected in favour of the deterministic engine.
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Trimmed non-empty string, or null when the value cannot serve as prose. */
const asText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

/** Numeric strings are coerced; anything unusable falls back to the engine's own start. */
const normalizeInitialScore = (value: unknown, fallback: number): number => {
  const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
    ? Number(value)
    : Number.NaN
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(INITIAL_SCORE_RANGE.max, Math.max(INITIAL_SCORE_RANGE.min, Math.round(numeric)))
}

/** provider personaId -> canonical Persona registry entry. */
const resolvePersona = (personaId: unknown) =>
  typeof personaId === 'string' ? PERSONAS.find((persona: { id: string }) => persona.id === personaId) ?? null : null

/**
 * Exactly three objections, one per Persona, in registry order.
 * Returns null when the structure cannot be repaired into the canonical shape.
 */
const resolveObjections = (value: unknown): CanonicalObjection[] | null => {
  if (!Array.isArray(value) || value.length !== PERSONAS.length) return null
  const resolved = new Map<string, CanonicalObjection>()
  for (const raw of value) {
    if (!isRecord(raw)) return null
    const persona = resolvePersona(raw.personaId)
    const text = asText(raw.text)
    const pressure = asText(raw.pressure)
    if (!persona || !text || !pressure) return null
    if (resolved.has(persona.id)) return null
    resolved.set(persona.id, { persona, text, pressure })
  }
  if (resolved.size !== PERSONAS.length) return null
  return PERSONAS.map((persona: { id: string }) => resolved.get(persona.id) as CanonicalObjection)
}

/**
 * Translate a provider payload into the canonical CaseAnalysis. Never throws.
 *
 * The deterministic engine supplies the canonical skeleton — its signals are the ones the
 * verdict is derived from, and its analysis is the fallback. A provider payload may only fill
 * the fields it is allowed to own: the three objections and the starting score.
 *
 * Returns the engine's analysis when the payload is missing, not an object, or cannot be
 * repaired into exactly three ordered objections with resolved Personas.
 */
export function translateProviderCase(input: CaseInput, draft: unknown): CanonicalCaseAnalysis {
  const baseline = analyzeCase(input)
  const fallback: CanonicalCaseAnalysis = {
    signals: baseline.signals,
    initialScore: baseline.initialScore,
    objections: baseline.objections,
  }
  if (!isRecord(draft)) return fallback

  const objections = resolveObjections(draft.objections)
  if (!objections) return fallback

  return {
    signals: baseline.signals,
    initialScore: normalizeInitialScore(draft.initialScore, baseline.initialScore),
    objections,
  }
}

/**
 * Ask a configured provider for a case, or fall back to the deterministic engine.
 *
 * The result is always the canonical CaseAnalysis: a transport failure, a non-JSON body, or a
 * payload the adapter cannot repair routes to the engine rather than to a caller.
 */
export async function generateCourtroomCase(input: CaseInput): Promise<CanonicalCaseAnalysis> {
  const env = typeof process !== 'undefined' ? process.env : {}
  try {
    if (env.OPENAI_API_KEY) return translateProviderCase(input, await askOpenAI(input, env.OPENAI_API_KEY))
    if (env.ANTHROPIC_API_KEY) return translateProviderCase(input, await askAnthropic(input, env.ANTHROPIC_API_KEY))
  } catch (error) {
    console.warn('[courtroom] Provider unavailable; using the deterministic engine.', error)
  }
  // No provider payload: the engine's analysis is the canonical result.
  return translateProviderCase(input, null)
}
