// The mock engine is intentionally deterministic, so the app is fully playable without a key.
// In production, call analyzeCaseServerSide from a protected API route and inject either
// OPENAI_API_KEY or ANTHROPIC_API_KEY there. Never expose provider keys in the browser.

export const PERSONAS = [
  {
    id: 'cfo',
    name: 'The Cynical CFO',
    shortName: 'CFO',
    title: 'Keeper of the burn rate',
    color: 'amber',
    initials: 'CF',
    accent: '#f3b63d',
    soft: 'rgba(243, 182, 61, .13)',
  },
  {
    id: 'parent',
    name: 'The Disappointed Parent',
    shortName: 'PARENT',
    title: 'Witness to your blind spots',
    color: 'crimson',
    initials: 'DP',
    accent: '#e26767',
    soft: 'rgba(226, 103, 103, .13)',
  },
  {
    id: 'competitor',
    name: 'The Paranoid Competitor',
    shortName: 'COMPETITOR',
    title: 'Already copying your landing page',
    color: 'cyan',
    initials: 'PC',
    accent: '#66d4e3',
    soft: 'rgba(102, 212, 227, .13)',
  },
]

/** The canonical starting envelope for a trial. One location, used by the engine and the provider adapter. */
export const INITIAL_SCORE_RANGE = { min: 18, max: 61 }

/**
 * The one owner of the survivability bands (the thresholds 40 and 75).
 *
 * Input is the canonical score: the normalized integer 0..100 a trial keeps. Classification
 * happens downstream of normalization — `createVerdict` rounds and clamps before calling this,
 * so a raw fractional score must never reach it (39.5 is the 40 band, not the 39 band).
 *
 * Returns the canonical band value, which is also the Verdict's `verdictType` vocabulary and an
 * external contract (the `verdict_type` analytics payload and the `data-verdict-type` attribute).
 * Presentation stays with the consumers: labels, tones, and copy are not the band's business.
 */
export const classifyBand = (score) => (score >= 75 ? 'acquitted' : score >= 40 ? 'probation' : 'convicted')

/** The sealed Verdict's canonical labels — domain output, printed verbatim by the stamp and the PDF. */
const VERDICT_LABELS = {
  convicted: 'CONVICTED OF DELUSION',
  probation: 'PROBATIONARY RISK',
  acquitted: 'STRESS-TESTED & ACQUITTED',
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const words = (value = '') => value.trim().split(/\s+/).filter(Boolean)
const lower = (value = '') => value.toLowerCase()

function parseSignals(title, plan, category) {
  const text = lower(`${title} ${plan}`)
  const signals = {
    hasMoney: /\$|php|budget|cost|revenue|salary|savings|runway|expense|price|income|profit/.test(text),
    hasTimeline: /week|month|quarter|year|deadline|timeline|by \d|days?/.test(text),
    hasFallback: /fallback|worst.?case|exit|return to|part.?time|stop|pivot|plan b|contingenc/.test(text),
    hasCustomer: /customer|audience|subscriber|user|client|buyer|market|interview|waitlist|pre.?order|validation/.test(text),
    hasDistribution: /distribution|channel|sales|partner|community|seo|audience|newsletter|content|network|referral/.test(text),
    hasMoat: /moat|defensib|patent|proprietary|unique|advantage|switching|brand|exclusive/.test(text),
    hasSupport: /partner|family|mentor|cofounder|team|friend|support/.test(text),
    hasRiskAcknowledgement: /risk|downside|danger|uncertain|assumption|if it fails|worst/.test(text),
    category,
  }
  signals.planWords = words(plan).length
  signals.titleWords = words(title).length
  signals.specificity = [signals.hasMoney, signals.hasTimeline, signals.hasFallback, signals.hasCustomer, signals.hasDistribution, signals.hasRiskAcknowledgement].filter(Boolean).length
  return signals
}

function buildObjections(title, plan, category, signals) {
  const subject = title || `this ${category.toLowerCase()} move`
  return [
    {
      persona: PERSONAS[0],
      text: signals.hasMoney
        ? `You have put a number on ${subject}, but a budget is not a survival model. What happens when acquisition costs double, the first revenue arrives late, and your personal runway is shorter than your optimism? Show me the trigger that makes you stop spending.`
        : `You have brought a dream to court, not a cash-flow model. How many months of runway does ${subject} consume, what is the real opportunity cost, and what exact signal tells you to stop before this becomes an expensive identity?`,
      pressure: signals.hasTimeline ? 'The clock is visible. The margin is not.' : 'No runway. No stop-loss. No mercy.',
    },
    {
      persona: PERSONAS[1],
      text: signals.hasFallback
        ? `You have named a way out, but you have not named the emotional price. When the novelty fades and people close to you ask whether this is working, what protects your energy, your relationships, and the version of you who has to live with a smaller outcome?`
        : `Tell the truth about the human cost. When the late nights stop feeling heroic, the people around you start asking questions, and the first version underperforms, what protects your health and your relationships? “I will work harder” is not a support system.`,
      pressure: signals.hasSupport ? 'Someone may catch you. The plan still needs to catch you first.' : 'Ambition is not a burnout protocol.',
    },
    {
      persona: PERSONAS[2],
      text: signals.hasMoat && signals.hasDistribution
        ? `Your moat sounds plausible on paper. Now assume a well-funded incumbent sees traction and ships your best feature in ninety days. Why do customers find you first, why do they stay, and what compounds faster for you than it does for them?`
        : signals.hasDistribution
          ? `You have a way to reach people, but not yet a reason they cannot leave. If a better-funded rival copies the visible idea next quarter, what stays uniquely yours—and why will distribution outrun their budget?`
          : `The idea is visible from space, which means it is copyable. If a better-funded rival ships the same promise next quarter, why do customers find you first, and what keeps them there after the novelty wears off?`,
      pressure: signals.hasMoat ? 'A moat is a behavior, not a adjective.' : 'If it can be copied in a weekend, it is a feature.',
    },
  ]
}

export function analyzeCase({ title, plan, category }) {
  const signals = parseSignals(title, plan, category)
  const categoryBoost = { Career: 2, Startup: 0, Financial: -3, Relocation: 1, Relationship: -1 }[category] ?? 0
  const initialScore = clamp(23 + signals.specificity * 5 + (signals.planWords >= 80 ? 5 : signals.planWords >= 45 ? 2 : 0) + categoryBoost, INITIAL_SCORE_RANGE.min, INITIAL_SCORE_RANGE.max)
  return {
    signals,
    initialScore,
    objections: buildObjections(title, plan, category, signals),
  }
}

export function evaluateRebuttal({ rebuttal, personaId, signals }) {
  const text = lower(rebuttal)
  const count = words(rebuttal).length
  const proofWords = /number|budget|php|\$|metric|test|pilot|customer|interview|waitlist|deadline|month|week|partner|contract|evidence|data|threshold|stop|fallback|cap/.test(text)
  const actionWords = /will|plan|measure|track|limit|cap|launch|ask|validate|ship|save|test|review|pause/.test(text)
  const denialWords = /just trust|it will work|nothing can go wrong|i know it will|figure it out later|no risk/.test(text)
  const lengthBonus = count >= 45 ? 5 : count >= 24 ? 3 : count >= 10 ? 1 : -2
  const delta = clamp(2 + lengthBonus + (proofWords ? 4 : 0) + (actionWords ? 2 : 0) - (denialWords ? 7 : 0), -5, 14)
  const responses = {
    cfo: delta >= 7 ? 'The numbers are finally speaking in complete sentences. I still dislike the margin, but I cannot call it imaginary.' : 'That is an assertion, not a control. I am marking the risk down, not clearing it.',
    parent: delta >= 7 ? 'That sounds like a grown-up boundary, not a motivational poster. I will allow the plan to continue—for now.' : 'You are asking courage to do the job of a support system. The record will reflect that.',
    competitor: delta >= 7 ? 'A measurable wedge and a reason to stay. Irritatingly defensible. I will need a faster copycat.' : 'You described the product. I asked what survives contact with a competitor.',
  }
  return {
    delta,
    reaction: responses[personaId] || 'The court has recorded your answer.',
    quality: delta >= 9 ? 'substantial' : delta >= 5 ? 'credible' : delta > 0 ? 'thin' : 'insufficient',
  }
}

export function createVerdict({ caseData, rebuttals, score }) {
  const { signals, objections } = caseData
  const finalScore = clamp(Math.round(score), 0, 100)
  const verdictType = classifyBand(finalScore)
  const verdictLabel = VERDICT_LABELS[verdictType]

  const missing = !signals.hasMoney
    ? { title: 'The unpriced downside', body: `The plan has no explicit cash boundary. Without a budget, runway, or stop-loss, ${caseData.title || 'the decision'} can quietly turn into an open-ended bet.` }
    : !signals.hasFallback
      ? { title: 'The missing exit ramp', body: 'You have described the upside, but not the conditions under which you pause, pivot, or walk away. Hope is not a contingency plan.' }
      : !signals.hasCustomer
        ? { title: 'Unproven demand', body: 'The case assumes someone will care before proving who that someone is. Validate the painful problem before scaling the elegant solution.' }
        : !signals.hasMoat
          ? { title: 'Copyability', body: 'The first mover advantage is not a moat. A competitor can copy the visible product; you need a compounding edge in trust, distribution, data, or habit.' }
          : { title: 'Execution drag', body: 'The logic is sound enough to be dangerous. The remaining risk is whether you can sustain the cadence when the work becomes repetitive.' }

  const scored = rebuttals.filter(Boolean).sort((a, b) => b.delta - a.delta)
  const strongest = scored[0]
  const strongestDefense = strongest?.text || 'No rebuttal was entered into the record.'
  const prescriptions = []
  if (!signals.hasMoney) prescriptions.push('Write a 90-day cash budget with a hard stop-loss before you commit.')
  else prescriptions.push('Run a downside budget: model revenue at half the optimistic case and set a review date.')
  if (!signals.hasCustomer) prescriptions.push('Interview five target users and secure three concrete signals of demand before building further.')
  else prescriptions.push('Turn your demand signal into a weekly metric that can veto your next major spend.')
  if (!signals.hasFallback) prescriptions.push('Define the pivot, pause, or return-to-safety trigger in writing—and tell one person who can hold you to it.')
  else if (!signals.hasMoat) prescriptions.push('Choose one compounding advantage and run a 30-day experiment that makes it harder to copy.')
  else prescriptions.push('Protect the operating cadence: schedule a monthly red-team review with someone outside the project.')

  return {
    score: finalScore,
    verdictType,
    verdictLabel,
    criticalBlindspot: missing,
    strongestDefense,
    strongestPersona: strongest?.personaName || 'the record',
    prescriptions,
    objections,
  }
}

export function captureEvent(eventName, payload = {}) {
  if (typeof window !== 'undefined') {
    // Optional PostHog integration: define window.posthog via the official snippet or SDK.
    if (window.posthog && typeof window.posthog.capture === 'function') {
      window.posthog.capture(eventName, payload)
    }
    window.dispatchEvent(new CustomEvent('courtroom:analytics', { detail: { eventName, payload } }))
  }
}

export async function analyzeCaseServerSide(input) {
  // Server-only seam for an OpenAI/Anthropic adapter. Keep provider keys on the server.
  // If no adapter is wired yet, the deterministic mock remains the safe default.
  return analyzeCase(input)
}

export const wordCount = (value = '') => words(value).length
export const characterCount = (value = '') => value.length
export const getCaseNumber = () => `#CASE-${Math.floor(1000 + Math.random() * 8999)}`
