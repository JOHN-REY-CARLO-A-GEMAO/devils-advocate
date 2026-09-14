import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Clock3,
  Copy,
  Download,
  Gavel,
  Landmark,
  Lock,
  Menu,
  Mic2,
  Scale,
  ShieldCheck,
  Skull,
  Sparkles,
  Target,
  TimerReset,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import {
  PERSONAS,
  advance,
  analyzeCase,
  answer,
  captureEvent,
  classifyBand,
  evaluateRebuttal,
  getCaseNumber,
  makeTrial,
  wordCount,
} from './lib/courtroom'
import './styles.css'

const CATEGORIES = ['Career', 'Startup', 'Financial', 'Relocation', 'Relationship']
const TICKER_ITEMS = [
  'CASE #8174 SURVIVED A 40% REVENUE CUT',
  'CASE #8041: BURN RATE FLAGGED IN ROUND 02',
  '68% OF FOUNDERS MISS THE EXIT RAMP',
  'CASE #8298 ACQUITTED AFTER CUSTOMER INTERVIEWS',
]
const EMPTY_FORM = { title: '', plan: '', category: 'Startup' }
// The trial gauge's own vocabulary for a still-provisional score. Deliberately different from the
// sealed Verdict's labels; only the band itself is canonical (classifyBand).
const GAUGE_LABELS = { convicted: 'GUILTY OF DELUSION', probation: 'PROBATIONARY', acquitted: 'BATTLE-TESTED' }
const GAUGE_TONES = { convicted: 'danger', probation: 'warning', acquitted: 'safe' }
// How long an answered round's reaction stays on screen before the next round opens or the
// verdict is sealed. Presentation timing: the domain machine has no timers.
const REVEAL_PAUSE_MS = 1150
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function App() {
  const [screen, setScreen] = useState('docket')
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [caseFile, setCaseFile] = useState(null)
  const [trial, setTrial] = useState(() => makeTrial(0))
  // The defense being typed. The draft is the UI's, not the machine's.
  const [rebuttal, setRebuttal] = useState('')
  const [verdict, setVerdict] = useState(null)
  const [deliberationStep, setDeliberationStep] = useState(0)
  const [toast, setToast] = useState('')
  const verdictTracked = useRef(false)

  const activePersona = caseFile ? caseFile.objections[trial.activeRound]?.persona : PERSONAS[0]
  const activeObjection = caseFile ? caseFile.objections[trial.activeRound] : null
  const submitted = trial.rebuttals.length > trial.activeRound
  const planWordCount = wordCount(form.plan)

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (screen !== 'deliberation') return undefined
    setDeliberationStep(0)
    const interval = window.setInterval(() => setDeliberationStep((step) => Math.min(step + 1, 3)), 700)
    const timeout = window.setTimeout(() => setScreen('verdict'), 2800)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [screen])

  useEffect(() => {
    if (screen === 'verdict' && verdict && !verdictTracked.current) {
      verdictTracked.current = true
      captureEvent('verdict_rendered', { final_score: verdict.score, verdict_type: verdict.verdictType })
    }
  }, [screen, verdict])

  // The reveal pause. Once a round has been answered the reaction stays on screen, then the
  // machine moves on — the next round opens, or the verdict is sealed. Owning this in an effect
  // is what makes it cancellable: bailing, resetting, or unmounting tears the effect down and
  // clears the timer, so no pending transition can fire for an abandoned case.
  useEffect(() => {
    if (screen !== 'trial' || !caseFile || trial.phase !== 'reaction') return undefined
    const timer = window.setTimeout(() => {
      const next = advance(trial, { caseData: caseFile })
      if (next.verdict) {
        setVerdict(next.verdict)
        setScreen('deliberation')
      } else {
        setTrial(next.trial)
        setRebuttal('')
        captureEvent('objection_faced', { round: next.trial.activeRound + 1, persona: caseFile.objections[next.trial.activeRound].persona.id })
      }
    }, REVEAL_PAUSE_MS)
    return () => window.clearTimeout(timer)
  }, [screen, trial, caseFile])

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    if (errors[field]) setErrors((current) => ({ ...current, [field]: '' }))
  }

  function startTrial(event) {
    event.preventDefault()
    const nextErrors = {}
    if (!form.title.trim()) nextErrors.title = 'Give the case a clear one-line title.'
    if (form.title.trim().length > 120) nextErrors.title = 'Keep the title under 120 characters.'
    if (!form.plan.trim()) nextErrors.plan = 'The court needs enough context to find the weak joints.'
    if (form.plan.trim() && planWordCount < 12) nextErrors.plan = 'Add a little more context — at least 12 words.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    const analysis = analyzeCase(form)
    const docket = { ...form, title: form.title.trim(), plan: form.plan.trim(), docket: getCaseNumber(), ...analysis }
    setCaseFile(docket)
    setTrial(makeTrial(analysis.initialScore))
    setRebuttal('')
    setVerdict(null)
    verdictTracked.current = false
    setScreen('trial')
    captureEvent('case_submitted', { category: form.category, plan_length: form.plan.length })
    captureEvent('objection_faced', { round: 1, persona: PERSONAS[0].id })
  }

  function submitRebuttal(event) {
    event.preventDefault()
    if (trial.phase === 'reaction' || submitted) return
    const defense = rebuttal.trim()
    if (!defense) {
      setToast('The clerk needs a defense before the court can proceed.')
      return
    }
    const evaluation = evaluateRebuttal({ rebuttal: defense, personaId: activePersona.id, signals: caseFile.signals })
    captureEvent('rebuttal_submitted', {
      round: trial.activeRound + 1,
      persona: activePersona.id,
      rebuttal_length: defense.length,
      score_delta: evaluation.delta,
    })
    // The machine records the answer; the reveal pause above carries it to the next round.
    setTrial(answer(trial, { rebuttal: defense, caseData: caseFile, evaluation }))
  }

  function bailOut() {
    captureEvent('trial_bailed', { round_dropped_at: trial.activeRound + 1 })
    setToast(`Case ${caseFile?.docket || ''} closed without a verdict.`)
    setScreen('docket')
    setCaseFile(null)
    setTrial(makeTrial(0))
    setRebuttal('')
  }

  function resetTrial() {
    setForm(EMPTY_FORM)
    setErrors({})
    setCaseFile(null)
    setVerdict(null)
    setTrial(makeTrial(0))
    setRebuttal('')
    setScreen('docket')
    verdictTracked.current = false
  }

  async function copyVerdict() {
    const docketLink = `${window.location.origin}${window.location.pathname}#${caseFile.docket.replace('#', '')}`
    try {
      await navigator.clipboard.writeText(docketLink)
      setToast('Docket link copied to clipboard.')
    } catch {
      setToast('The link is ready: ' + docketLink)
    }
  }

  function downloadPdf() {
    if (!verdict || !caseFile) return
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const margin = 52
    const width = 595
    doc.setFillColor(9, 11, 16)
    doc.rect(0, 0, width, 842, 'F')
    doc.setTextColor(243, 182, 61)
    doc.setFont('courier', 'bold')
    doc.setFontSize(9)
    doc.text('THE DEVIL\'S ADVOCATE  //  PRE-MORTEM DIVISION', margin, 52)
    doc.setDrawColor(55, 60, 69)
    doc.line(margin, 68, width - margin, 68)
    doc.setTextColor(235, 236, 238)
    doc.setFont('times', 'bold')
    doc.setFontSize(25)
    doc.text('OFFICIAL VERDICT', margin, 112)
    doc.setFont('courier', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(150, 157, 168)
    doc.text(`${caseFile.docket}   |   ${caseFile.category.toUpperCase()}   |   ${new Date().toLocaleDateString()}`, margin, 134)
    doc.setTextColor(243, 182, 61)
    doc.setFont('courier', 'bold')
    doc.setFontSize(13)
    doc.text(verdict.verdictLabel, margin, 172)
    doc.setTextColor(235, 236, 238)
    doc.setFont('times', 'bold')
    doc.setFontSize(38)
    doc.text(`${verdict.score}/100`, margin, 218)
    doc.setFont('courier', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(150, 157, 168)
    doc.text('SURVIVABILITY SCORE', margin, 237)

    let y = 282
    const addSection = (label, text) => {
      doc.setTextColor(243, 182, 61)
      doc.setFont('courier', 'bold')
      doc.setFontSize(9)
      doc.text(label.toUpperCase(), margin, y)
      y += 17
      doc.setTextColor(220, 222, 226)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      const lines = doc.splitTextToSize(text, width - margin * 2)
      doc.text(lines, margin, y)
      y += lines.length * 16 + 22
    }
    addSection('THE CASE', caseFile.title)
    addSection('CRITICAL BLINDSPOT', `${verdict.criticalBlindspot.title}: ${verdict.criticalBlindspot.body}`)
    addSection('STRONGEST DEFENSE', verdict.strongestDefense)
    doc.setTextColor(243, 182, 61)
    doc.setFont('courier', 'bold')
    doc.setFontSize(9)
    doc.text('JURY PRESCRIPTION', margin, y)
    y += 18
    verdict.prescriptions.forEach((item, index) => {
      doc.setTextColor(243, 182, 61)
      doc.text(`0${index + 1}`, margin, y)
      doc.setTextColor(220, 222, 226)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      const lines = doc.splitTextToSize(item, width - margin * 2 - 25)
      doc.text(lines, margin + 25, y)
      y += lines.length * 14 + 12
    })
    doc.setDrawColor(55, 60, 69)
    doc.line(margin, 770, width - margin, 770)
    doc.setTextColor(114, 121, 132)
    doc.setFont('courier', 'normal')
    doc.setFontSize(8)
    doc.text('Generated by The Devil\'s Advocate. A pre-mortem is not a prophecy.', margin, 793)
    doc.save(`${caseFile.docket.replace('#', '').toLowerCase()}-official-verdict.pdf`)
    captureEvent('pdf_downloaded')
    setToast('Official verdict downloaded.')
  }

  return (
    <div className="app-shell">
      <div className="grain" aria-hidden="true" />
      <AmbientLines />
      <Header screen={screen} docket={caseFile?.docket} />
      <AnimatePresence mode="wait">
        {screen === 'docket' && (
          <DocketScreen key="docket" form={form} errors={errors} updateForm={updateForm} startTrial={startTrial} planWordCount={planWordCount} />
        )}
        {screen === 'trial' && caseFile && (
          <TrialScreen
            key="trial"
            caseFile={caseFile}
            trial={trial}
            activePersona={activePersona}
            activeObjection={activeObjection}
            submitted={submitted}
            rebuttal={rebuttal}
            submitRebuttal={submitRebuttal}
            setRebuttal={setRebuttal}
            bailOut={bailOut}
          />
        )}
        {screen === 'deliberation' && <DeliberationScreen key="deliberation" step={deliberationStep} />}
        {screen === 'verdict' && verdict && caseFile && (
          <VerdictScreen key="verdict" caseFile={caseFile} verdict={verdict} downloadPdf={downloadPdf} copyVerdict={copyVerdict} resetTrial={resetTrial} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="toast"><Check size={15} /> {toast}</motion.div>}
      </AnimatePresence>
    </div>
  )
}

function Header({ screen, docket }) {
  const stage = { docket: 'OPEN DOCKET', trial: 'PROCEEDING LIVE', deliberation: 'JURY IN SESSION', verdict: 'RECORD SEALED' }[screen]
  return (
    <header className="site-header">
      <div className="brand-lockup">
        <div className="brand-mark"><Gavel size={18} strokeWidth={1.8} /></div>
        <div>
          <div className="brand-name">THE DEVIL'S ADVOCATE</div>
          <div className="brand-sub">PRE-MORTEM DIVISION <span className="slash">//</span> <span className="brand-dim">EST. 2024</span></div>
        </div>
      </div>
      <div className="header-status"><span className="status-dot" /> {stage} {docket && <><span className="status-separator">/</span><span className="header-docket">{docket}</span></>}</div>
      <button className="header-menu" type="button" aria-label="Open navigation"><Menu size={18} /></button>
    </header>
  )
}

function AmbientLines() {
  return <div className="ambient-lines" aria-hidden="true"><span /><span /><span /><span /><i /></div>
}

function DocketScreen({ form, errors, updateForm, startTrial, planWordCount }) {
  return (
    <motion.main className="docket-page page-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <section className="docket-hero">
        <div className="eyebrow"><span className="eyebrow-line" /> CASE DOCKET / 001</div>
        <h1>Stress-test your <em>ambition</em><br />before reality executes it.</h1>
        <p className="hero-copy">An adversarial pre-mortem for decisions too important to leave to optimism. Three critics. Three rounds. One honest record.</p>
        <div className="hero-meta"><div><span className="meta-number">03</span><span> hostile witnesses</span></div><div><span className="meta-number">01</span><span> official verdict</span></div></div>
        <Ticker />
      </section>
      <section className="docket-panel-wrap">
        <div className="panel-topline"><span>NEW CASE INTAKE</span><span className="panel-lock"><Lock size={12} /> ENCRYPTED</span></div>
        <form className="docket-panel" onSubmit={startTrial} noValidate>
          <div className="panel-heading"><div><div className="form-kicker">PETITIONER'S FILING</div><h2>Put the decision on record.</h2></div><Scale size={28} className="heading-scale" /></div>
          <label className="field-label" htmlFor="case-title">Decision title <span>ONE LINE</span></label>
          <div className={`input-wrap ${errors.title ? 'has-error' : ''}`}><input id="case-title" value={form.title} maxLength={120} onChange={(event) => updateForm('title', event.target.value)} placeholder="e.g. Quit my job to build a niche newsletter" /><span className="input-count">{form.title.length}/120</span></div>
          {errors.title && <div className="field-error"><AlertTriangle size={13} /> {errors.title}</div>}
          <label className="field-label plan-label" htmlFor="case-plan">The full plan <span>CONTEXT / BUDGET / TIMELINE / FALLBACK</span></label>
          <div className={`textarea-wrap ${errors.plan ? 'has-error' : ''}`}><textarea id="case-plan" value={form.plan} maxLength={3000} onChange={(event) => updateForm('plan', event.target.value)} placeholder="Give the critics enough to work with. What are you risking, what will you do first, and what happens if it goes badly?" /><div className="textarea-footer"><span>Be specific. The court rewards receipts.</span><span>{planWordCount} words</span></div></div>
          {errors.plan && <div className="field-error"><AlertTriangle size={13} /> {errors.plan}</div>}
          <fieldset className="category-field"><legend className="field-label">Risk category <span>SELECT ONE</span></legend><div className="category-grid">{CATEGORIES.map((category) => <button type="button" key={category} className={`category-chip ${form.category === category ? 'selected' : ''}`} onClick={() => updateForm('category', category)}>{form.category === category && <Check size={13} />}{category}</button>)}</div></fieldset>
          <button className="primary-button start-button" id="btn-start-trial" data-posthog-event="case_submitted" type="submit"><span>Step into the witness stand</span><ArrowRight size={17} /></button>
          <div className="form-note"><ShieldCheck size={13} /> Your case is private. Mock engine active <span className="mini-live">●</span></div>
        </form>
        <div className="panel-foot"><span>NO ACCOUNT REQUIRED</span><span>FREE TO RUN</span><span>RIGOROUS BY DESIGN</span></div>
      </section>
    </motion.main>
  )
}

function Ticker() {
  return <div className="ticker"><div className="ticker-label"><span className="live-dot" /> RECENTLY ON THE RECORD</div><div className="ticker-window"><div className="ticker-track">{[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, index) => <span key={`${item}-${index}`}>{item}<b>✦</b></span>)}</div></div></div>
}

function TrialScreen({ caseFile, trial, activePersona, activeObjection, submitted, rebuttal, submitRebuttal, setRebuttal, bailOut }) {
  const band = classifyBand(trial.score)
  const scoreLabel = GAUGE_LABELS[band]
  const scoreProgress = clamp(trial.score, 0, 100)
  const reaction = trial.phase === 'reaction'
  // How many rounds this trial runs is a fact about the Case (one round per Objection), not a
  // presentation constant and not Verdict state. The Trial owns only the round it is on.
  const totalRounds = String(caseFile.objections.length).padStart(2, '0')
  return (
    <motion.main className="trial-page page-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="trial-topline"><div><span className="eyebrow-line" /> CROSS-EXAMINATION / LIVE PROCEEDING</div><div className="trial-clock"><Clock3 size={13} /> RECORDING ACTIVE</div></div>
      <section className="trial-dashboard">
        <div className="gauge-card"><div className="gauge-head"><span>SURVIVABILITY GAUGE</span><strong>{trial.score}<small>/100</small></strong></div><div className="gauge-bar"><motion.div className={`gauge-fill ${GAUGE_TONES[band]}`} animate={{ width: `${scoreProgress}%` }} transition={{ type: 'spring', stiffness: 80, damping: 18 }} /></div><div className="gauge-scale"><span>GUILTY OF DELUSION</span><span>{scoreLabel}</span><span>BATTLE-TESTED</span></div></div>
        <div className="case-id-block"><span>CASE DOCKET</span><strong>{caseFile.docket}</strong><small>{caseFile.category.toUpperCase()} / PRIVATE RECORD</small></div>
        <div className="round-block"><span>ROUND</span><strong>0{trial.activeRound + 1}<small> / {totalRounds}</small></strong><div className="round-dots">{caseFile.objections.map((objection, round) => <span key={objection.persona.id} className={round <= trial.activeRound ? 'active' : ''} />)}</div></div>
      </section>
      <div className="trial-grid">
        <section className="witness-column">
          <div className="witness-caption"><span>THE WITNESS STAND</span><span>WITNESS 0{trial.activeRound + 1} / {totalRounds}</span></div>
          <AnimatePresence mode="wait">
            <motion.div key={activePersona.id} className={`witness-card persona-${activePersona.color}`} data-posthog-event="objection_faced" data-round={trial.activeRound + 1} data-persona={activePersona.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: .38 }}>
              <div className="witness-card-glow" />
              <div className="witness-header"><div className="avatar" style={{ '--persona-accent': activePersona.accent, '--persona-soft': activePersona.soft }}>{activePersona.initials}<span className="avatar-signal" /></div><div><div className="persona-role" style={{ color: activePersona.accent }}>{activePersona.title}</div><h2>{activePersona.name}</h2></div><div className="witness-badge"><Mic2 size={13} /> UNDER OATH</div></div>
              <div className="objection-divider"><span>OBJECTION {String(trial.activeRound + 1).padStart(2, '0')}</span><span className="divider-line" /><span className="objection-type">{activePersona.shortName}</span></div>
              <p className="objection-text">{activeObjection.text}</p>
              <div className="pressure-line"><AlertTriangle size={14} /><span>{activeObjection.pressure}</span></div>
              <div className="witness-card-footer"><span><span className="signal-dot" /> ANALYSIS ENGINE / {activePersona.id.toUpperCase()}</span><span>DO NOT DODGE THE QUESTION</span></div>
            </motion.div>
          </AnimatePresence>
          <AnimatePresence mode="wait">
            {reaction ? <motion.div key="reaction" className={`reaction-card reaction-${activePersona.color}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div className="reaction-icon"><Zap size={15} /></div><div><span className="reaction-label">{activePersona.shortName}'S REACTION</span><p>{trial.reaction}</p></div><div className="score-delta">{trial.rebuttals.at(-1)?.delta > 0 ? '+' : ''}{trial.rebuttals.at(-1)?.delta} <small>PTS</small></div></motion.div> : <motion.form key="defense" className="defense-panel" data-posthog-event="rebuttal_submitted" data-round={trial.activeRound + 1} data-persona={activePersona.id} onSubmit={submitRebuttal}><div className="defense-heading"><div><span className="form-kicker">YOUR TURN, PETITIONER</span><h3>Submit your defense <em>under oath.</em></h3></div><span className="defense-count">{wordCount(rebuttal)} / 120 WORDS</span></div><textarea aria-label="Submit your defense under oath" value={rebuttal} maxLength={1000} onChange={(event) => setRebuttal(event.target.value)} placeholder="Answer the specific objection. Receipts beat reassurance." autoFocus={!submitted} /><div className="defense-bottom"><span className={wordCount(rebuttal) > 0 ? 'ready-label' : ''}>{wordCount(rebuttal) > 0 ? 'DEFENSE READY FOR THE RECORD' : 'A specific answer earns a stronger score'}</span><button className="primary-button" id={`btn-submit-rebuttal-round-${trial.activeRound + 1}`} type="submit">Submit rebuttal <ArrowRight size={15} /></button></div></motion.form>}
          </AnimatePresence>
        </section>
        <aside className="record-sidebar">
          <div className="sidebar-label">CASE RECORD <span>LIVE</span></div>
          <div className="case-summary"><div className="summary-icon"><Target size={18} /></div><div><span>THE DECISION</span><strong>{caseFile.title}</strong></div></div>
          <div className="proceeding-list"><div className="sidebar-label">THE CRITICS <span>SEQUENTIAL</span></div>{PERSONAS.map((persona, index) => { const isPast = index < trial.activeRound; const isCurrent = index === trial.activeRound; return <div className={`proceeding-item ${isCurrent ? 'current' : ''} ${isPast ? 'past' : ''}`} key={persona.id}><div className="step-marker">{isPast ? <Check size={13} /> : <span>0{index + 1}</span>}</div><div><strong>{persona.name}</strong><span>{isPast ? 'OBJECTION ANSWERED' : isCurrent ? 'ON THE STAND NOW' : 'WAITING IN CHAMBERS'}</span></div>{isCurrent && <span className="item-pulse" />}</div>})}</div>
          <div className="sidebar-rule" />
          <div className="record-tip"><CircleHelp size={15} /><div><strong>How this works</strong><p>Answer all three critics. Your score moves on the quality of the defense, not the confidence of the claim.</p></div></div>
          <button className="bail-link" id="btn-bail-out" data-posthog-event="trial_bailed" type="button" onClick={bailOut}><X size={13} /> Plead No Contest <span>(bail)</span></button>
        </aside>
      </div>
    </motion.main>
  )
}

const DELIBERATION_STEPS = ['Auditing assumptions...', 'Stress-testing cash flow...', 'Simulating the copycat...', 'Synthesizing jury consensus...']
function DeliberationScreen({ step }) {
  return <motion.main className="deliberation-page page-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="deliberation-center"><motion.div className="gavel-orbit" animate={{ rotate: [0, -8, 0] }} transition={{ duration: 1.25, repeat: Infinity, ease: 'easeInOut' }}><div className="orbit-ring" /><Gavel size={56} strokeWidth={1.1} /></motion.div><div className="eyebrow centered"><span className="eyebrow-line" /> INTERMISSION / JURY DELIBERATION <span className="eyebrow-line" /></div><h1>The record is being<br /><em>weighed.</em></h1><p>Three hostile perspectives. One clean recommendation.</p><div className="deliberation-list">{DELIBERATION_STEPS.map((status, index) => <div className={`deliberation-row ${index < step ? 'complete' : ''} ${index === step ? 'active' : ''}`} key={status}>{index < step ? <Check size={14} /> : index === step ? <span className="spinner" /> : <span className="pending-dot" />}<span>{status}</span>{index < step && <small>DONE</small>}</div>)}</div><div className="slam-line"><span /><strong>GAVEL DOWN</strong><span /></div></div></motion.main>
}

function VerdictScreen({ caseFile, verdict, downloadPdf, copyVerdict, resetTrial }) {
  const tone = verdict.verdictType === 'acquitted' ? 'safe' : verdict.verdictType === 'probation' ? 'warning' : 'danger'
  const verdictHeadline = verdict.verdictType === 'acquitted'
    ? <>Your ambition<br /><em>survives — for now.</em></>
    : verdict.verdictType === 'probation'
      ? <>Your ambition<br /><em>needs conditions.</em></>
      : <>Your ambition<br /><em>needs a rewrite.</em></>
  // The Case owns how many rounds a trial has (one round per Objection). The Verdict carries the
  // judgment only, so this document reads the count from the Case rather than holding a copy.
  const totalRounds = String(caseFile.objections.length).padStart(2, '0')
  return <motion.main className="verdict-page page-wrap" data-posthog-event="verdict_rendered" data-verdict-type={verdict.verdictType} data-final-score={verdict.score} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <div className="verdict-top"><div><span className="eyebrow-line" /> FINAL VERDICT / RECORD SEALED</div><div className="verdict-case">{caseFile.docket} <span>·</span> {caseFile.category.toUpperCase()}</div></div>
    <section className="verdict-hero"><div className="verdict-copy"><div className="eyebrow"><Sparkles size={14} /> THE JURY HAS SPOKEN</div><h1>{verdictHeadline}</h1><p>The court reviewed the plan, the pressure points, and every defense entered under oath.</p></div><div className={`stamp-wrap stamp-${tone}`}><motion.div className="verdict-stamp" initial={{ scale: 2.4, rotate: -18, opacity: 0 }} animate={{ scale: 1, rotate: -8, opacity: 1 }} transition={{ type: 'spring', stiffness: 180, damping: 13, delay: .2 }}><span>{verdict.verdictLabel}</span><small>THE DEVIL'S ADVOCATE</small></motion.div></div></section>
    <section className="score-band"><div className="score-number"><span>SURVIVABILITY SCORE</span><strong>{verdict.score}<small>/100</small></strong></div><div className="score-meter"><div className="score-meter-bar"><motion.div initial={{ width: 0 }} animate={{ width: `${verdict.score}%` }} transition={{ duration: 1, delay: .3 }} className={`gauge-fill ${tone}`} /></div><div className="score-meter-labels"><span>DELUSION</span><span>PROBATION</span><span>BATTLE-TESTED</span></div></div><div className="score-rounds"><span>ROUNDS COMPLETED</span><strong>{totalRounds} <small>/ {totalRounds}</small></strong><span className="completed-label"><Check size={12} /> COMPLETE</span></div></section>
    <div className="verdict-grid"><section className="blindspot-card report-card"><div className="report-card-top"><span className="card-index">01</span><span className="report-label">CRITICAL BLINDSPOT</span><AlertTriangle size={18} /></div><h2>{verdict.criticalBlindspot.title}</h2><p>{verdict.criticalBlindspot.body}</p><div className="card-tag"><span className="tag-dot" /> MOST DANGEROUS UNANSWERED RISK</div></section><section className="defense-card report-card"><div className="report-card-top"><span className="card-index">02</span><span className="report-label">STRONGEST DEFENSE</span><ShieldCheck size={18} /></div><blockquote>“{verdict.strongestDefense}”</blockquote><div className="card-tag"><span className="tag-dot cyan-dot" /> ENTERED BY {verdict.strongestPersona.toUpperCase()}</div></section><section className="prescription-card report-card"><div className="report-card-top"><span className="card-index">03</span><span className="report-label">JURY PRESCRIPTION</span><Landmark size={18} /></div><h2>Before you proceed:</h2><ol>{verdict.prescriptions.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ol></section></div>
    <section className="verdict-actions"><div><span className="form-kicker">OFFICIAL CASE FILE</span><p>Keep this record. Revisit it when the decision changes shape.</p></div><div className="action-buttons"><button className="secondary-button" id="btn-copy-verdict" type="button" onClick={copyVerdict}><Copy size={15} /> Copy docket link</button><button className="primary-button" id="btn-download-pdf" data-posthog-event="pdf_downloaded" type="button" onClick={downloadPdf}><Download size={15} /> Download official PDF verdict</button><button className="text-button" id="btn-reset-trial" type="button" onClick={resetTrial}>Try another decision <ArrowRight size={15} /></button></div></section>
    <div className="verdict-footnote"><Skull size={14} /> A pre-mortem is not a prophecy. It is a better starting position.</div>
  </motion.main>
}

createRoot(document.getElementById('root')).render(<App />)
