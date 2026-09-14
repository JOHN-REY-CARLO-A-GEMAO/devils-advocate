/**
 * Server-side AI seam for the pre-mortem engine.
 *
 * This file is intentionally not imported by the browser bundle. Wire it to a
 * Next.js route, edge function, or your own server and keep OPENAI_API_KEY /
 * ANTHROPIC_API_KEY in server-only environment variables.
 */

export type RiskCategory = 'Career' | 'Startup' | 'Financial' | 'Relocation' | 'Relationship'
export type CaseInput = { title: string; plan: string; category: RiskCategory }
export type Provider = 'openai' | 'anthropic' | 'mock'

const SYSTEM_PROMPT = `You are an adversarial pre-mortem courtroom. Return valid JSON only.
Analyze the user's decision through three distinct critics: The Cynical CFO, The Disappointed Parent,
and The Paranoid Competitor. Return {initialScore:number, objections:[{personaId:string,text:string,pressure:string}],
criticalBlindspot:string, prescriptions:string[]}. Be specific to the case, direct but useful, and never invent facts.`

const mockFallback = (input: CaseInput) => {
  const text = `${input.title} ${input.plan}`.toLowerCase()
  const has = (pattern: RegExp) => pattern.test(text)
  const detail = [
    has(/budget|php|\$|saving|runway|revenue/) ? 1 : 0,
    has(/customer|audience|user|client|waitlist|interview/) ? 1 : 0,
    has(/timeline|month|week|quarter|deadline/) ? 1 : 0,
    has(/fallback|pivot|stop|worst|plan b/) ? 1 : 0,
  ].reduce((a, b) => a + b, 0)
  return {
    provider: 'mock' as Provider,
    initialScore: Math.min(60, 24 + detail * 7),
    objections: [
      { personaId: 'cfo', text: `What is the hard cash boundary for ${input.title}?`, pressure: 'No stop-loss. No mercy.' },
      { personaId: 'parent', text: 'What protects your energy and relationships when the first version underperforms?', pressure: 'Ambition is not a burnout protocol.' },
      { personaId: 'competitor', text: 'What stays uniquely yours when a better-funded rival copies the visible idea?', pressure: 'A feature is not a moat.' },
    ],
    criticalBlindspot: has(/budget|php|\$|saving|runway/) ? 'The missing exit ramp' : 'The unpriced downside',
    prescriptions: ['Set a written downside budget and review date.', 'Validate demand with real conversations before scaling.', 'Define a pause, pivot, or return-to-safety trigger.'],
  }
}

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

/** Prefer a configured provider, but always return a playable result if it fails. */
export async function generateCourtroomCase(input: CaseInput) {
  const env = typeof process !== 'undefined' ? process.env : {}
  try {
    if (env.OPENAI_API_KEY) return { ...(await askOpenAI(input, env.OPENAI_API_KEY)), provider: 'openai' as Provider }
    if (env.ANTHROPIC_API_KEY) return { ...(await askAnthropic(input, env.ANTHROPIC_API_KEY)), provider: 'anthropic' as Provider }
  } catch (error) {
    console.warn('[courtroom] Provider unavailable; using mock engine.', error)
  }
  return mockFallback(input)
}
