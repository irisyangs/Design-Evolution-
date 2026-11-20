import React, { useEffect, useMemo, useState } from 'react';
import { domains } from './domains/index.js';
import { randomGenome, nextGeneration, mutate, borrowFeature } from './engine.js';
import { Sketch, Chooser, KeepPanel, Trail, RenderStep, ResearchRatings } from './components.jsx';
import { renderers } from './renderers.js';
import {
  beginSession,
  downloadSession,
  finishSession,
  loadActiveSession,
  loadCompletedSessions,
  nextSessionId,
  recordEvent,
} from './research.js';

const COUNT = 36;

function categoryFor(domain) {
  if (domain.id === 'tops') return 'top';
  if (domain.id === 'vessels') return 'mug';
  return 'other';
}

function makeCandidateIds(session, generationIndex, count) {
  if (!session) return [];
  const generation = String(generationIndex).padStart(3, '0');
  return Array.from({ length: count }, (_, i) =>
    `${session.session_id}-G${generation}-C${String(i + 1).padStart(3, '0')}`
  );
}

function nextLoggedGeneration(session) {
  const shownGenerations = (session?.events || [])
    .filter((event) => event.event_type === 'candidate_shown')
    .map((event) => Number(event.generation_index) || 0);
  return shownGenerations.length ? Math.max(...shownGenerations) + 1 : 0;
}

function readInitialStudyData() {
  if (new URLSearchParams(window.location.search).get('study') !== '1') {
    return { active: null, completed: [], error: '' };
  }
  try {
    return { active: loadActiveSession(), completed: loadCompletedSessions(), error: '' };
  } catch (error) {
    return { active: null, completed: [], error: error.message || 'Could not read study data from this browser.' };
  }
}

function ResearchControls({ studyMode, session, completedSessions, error, onEnd }) {
  if (!studyMode || (!session && !completedSessions.length && !error)) return null;

  return (
    <section className="research-toolbar" aria-label="Research session controls">
      {session && <p>Session <strong>{session.session_id}</strong> is being saved in this browser.</p>}
      {error && <p className="error" role="alert">Study logging problem: {error}</p>}
      {session && (
        <div className="row research-toolbar-actions">
          <button type="button" onClick={() => downloadSession(session, 'csv')}>Download current CSV</button>
          <button type="button" onClick={() => downloadSession(session, 'json')}>Download current JSON</button>
          <button type="button" className="primary" onClick={onEnd}>End study</button>
        </div>
      )}
      {completedSessions.length > 0 && (
        <div className="research-downloads">
          <div className="label">Completed study downloads</div>
          {completedSessions.map((completed) => (
            <div className="row research-download-row" key={completed.session_id}>
              <span>{completed.session_id}</span>
              <button type="button" onClick={() => downloadSession(completed, 'csv')}>Download CSV</button>
              <button type="button" onClick={() => downloadSession(completed, 'json')}>Download JSON</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function renderApiUrl() {
  const configuredApiBase = import.meta.env.VITE_RENDER_API_BASE_URL?.trim();
  if (import.meta.env.PROD && !configuredApiBase) {
    throw new Error('AI rendering on GitHub Pages needs a separately hosted API. Configure the VITE_RENDER_API_BASE_URL GitHub Actions variable; keep FLUX_API_KEY on that server.');
  }
  const base = configuredApiBase || import.meta.env.BASE_URL;
  return `${base.replace(/\/+$/, '')}/api/flux-render`;
}

// The one place a renderer plugs in. Given a design and its text prompt, return one result:
//   { url, kind: 'image' | 'model', filename }   (filename is what the Download button saves it as)
async function connectFalRenderer({ domain, design, prompt, rendererId }) {
  let image;
  if (rendererId !== 'meshy-text') {
    const canvas = document.createElement('canvas');
    canvas.width = 1040;
    canvas.height = 1040;
    domain.draw(canvas, design, { labels: false });
    image = canvas.toDataURL('image/png');
  }
  const response = await fetch(renderApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, prompt, rendererId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'FLUX rendering failed.');
  return {
    url: data.url,
    kind: data.kind,
    previewUrl: data.previewUrl,
    filename: data.filename || `${domain.id}-${rendererId === 'meshy-text' ? 'meshy-model.glb' : rendererId === 'trellis' ? 'trellis-model.glb' : rendererId === 'tripo-api' ? 'tripo-model.glb' : rendererId === 'hunyuan3d' ? 'hunyuan-model.glb' : 'flux-render.png'}`,
  };
}

export default function App() {
  const [studyMode, setStudyMode] = useState(() => new URLSearchParams(window.location.search).get('study') === '1');
  const [initialStudyData] = useState(readInitialStudyData);
  const [studySession, setStudySession] = useState(initialStudyData.active);
  const [completedSessions, setCompletedSessions] = useState(initialStudyData.completed);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentGiven, setConsentGiven] = useState(Boolean(initialStudyData.active));
  const [researchError, setResearchError] = useState(initialStudyData.error);
  const [domain, setDomain] = useState(null);
  const [cells, setCells] = useState([]);
  const [candidateIds, setCandidateIds] = useState([]);
  const [trail, setTrail] = useState([]);
  const [trailCandidateIds, setTrailCandidateIds] = useState([]);
  const [trailGenerationIndices, setTrailGenerationIndices] = useState([]);
  const [generationIndex, setGenerationIndex] = useState(0);
  const [lastSelection, setLastSelection] = useState(null);
  const [kept, setKept] = useState(new Set());
  const [strength, setStrength] = useState(0.2);
  const [donor, setDonor] = useState(null);          // index of a tile chosen with "Borrow a feature"
  const [borrowMode, setBorrowMode] = useState(false);
  const [render, setRender] = useState(null);        // { design, result } when the render step is open
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderError, setRenderError] = useState('');
  const [log, setLog] = useState([]);

  const samples = useMemo(() => Object.fromEntries(domains.map((d) => [d.id, [0, 1, 2].map(() => randomGenome(d))])), []);
  const parent = trail[trail.length - 1] || null;

  function continueWithoutStudy() {
    const url = new URL(window.location.href);
    url.searchParams.delete('study');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setStudyMode(false);
  }

  function persistResearchEvents(events, session = studySession) {
    if (!studyMode || !session || researchError) return session;
    let updated = session;
    try {
      for (const event of events) updated = recordEvent(updated, event);
    } catch (error) {
      setResearchError(`Could not save this event to browser storage: ${error.message || 'storage unavailable'}. This session may be incomplete.`);
    }
    setStudySession(updated);
    return updated;
  }

  function candidateShownEvents(d, genomes, ids, boardGeneration) {
    return genomes.map((genome, index) => ({
      event_type: 'candidate_shown',
      generation_index: boardGeneration,
      product_category: categoryFor(d),
      candidate_id: ids[index],
      genome_parameters: genome,
    }));
  }

  function start(d) {
    let session = studySession;
    let createdSession = false;
    if (studyMode && consentGiven && !session) {
      if (researchError) return;
      try {
        session = beginSession(nextSessionId(), categoryFor(d));
        createdSession = true;
      } catch (error) {
        setResearchError(`Could not start a saved study session: ${error.message || 'browser storage unavailable'}.`);
        return;
      }
    }
    const boardGeneration = !session ? 0
      : createdSession ? 0
        : domain ? generationIndex + 1
          : nextLoggedGeneration(session);
    const nextCells = Array.from({ length: COUNT }, () => randomGenome(d));
    const nextIds = makeCandidateIds(session, boardGeneration, nextCells.length);
    if (session) {
      session = persistResearchEvents(candidateShownEvents(d, nextCells, nextIds, boardGeneration), session);
      setStudySession(session);
    }
    setDomain(d); setTrail([]); setTrailCandidateIds([]); setTrailGenerationIndices([]);
    setGenerationIndex(boardGeneration); setCandidateIds(nextIds); setLastSelection(null);
    setKept(new Set()); setRender(null); setLog([]); setDonor(null); setBorrowMode(false);
    setCells(nextCells);
  }

  function advanceDesign(g, s, keptNow = kept, options = {}) {
    const {
      selectedId = '',
      selectedGeneration = generationIndex,
      trailId = selectedId,
      controlAction = '',
      controlCandidateId = '',
      controlSelectedId = '',
      controlGenome = g,
      extra = {},
    } = options;
    const nextGenerationIndex = generationIndex + 1;
    const nextCells = nextGeneration(domain, g, s, keptNow, COUNT);
    const nextIds = makeCandidateIds(studySession, nextGenerationIndex, nextCells.length);
    const events = [];

    if (controlAction) {
      events.push({
        event_type: 'control_changed', generation_index: generationIndex,
        product_category: categoryFor(domain), candidate_id: controlCandidateId,
        selected_candidate_id: controlSelectedId, genome_parameters: controlGenome,
        control_action: controlAction,
      });
    }
    if (selectedId) {
      events.push({
        event_type: 'selected', generation_index: selectedGeneration,
        product_category: categoryFor(domain), candidate_id: selectedId,
        selected_candidate_id: selectedId, genome_parameters: g,
      });
    }
    events.push(...candidateShownEvents(domain, nextCells, nextIds, nextGenerationIndex));
    persistResearchEvents(events);

    setStrength(s);
    setTrail((t) => [...t, g]);
    setTrailCandidateIds((ids) => [...ids, trailId]);
    setTrailGenerationIndices((indices) => [...indices, selectedGeneration]);
    setGenerationIndex(nextGenerationIndex); setCandidateIds(nextIds); setCells(nextCells);
    setLastSelection(selectedId || controlSelectedId
      ? { id: selectedId || controlSelectedId, genome: g, generationIndex: selectedGeneration }
      : null);
    setLog((l) => [...l, { t: Date.now(), strength: s, genome: g, kept: [...keptNow], ...extra }]);
  }

  function regenerateForControl(nextKept, action) {
    if (!parent || !domain) return;
    const nextGenerationIndex = generationIndex + 1;
    const nextCells = nextGeneration(domain, parent, Math.max(strength, 0.12), nextKept, COUNT);
    const nextIds = makeCandidateIds(studySession, nextGenerationIndex, nextCells.length);
    const parentId = trailCandidateIds[trailCandidateIds.length - 1] || '';
    const events = [{
      event_type: 'control_changed', generation_index: generationIndex,
      product_category: categoryFor(domain), candidate_id: parentId,
      selected_candidate_id: parentId, genome_parameters: parent, control_action: action,
    }, ...candidateShownEvents(domain, nextCells, nextIds, nextGenerationIndex)];
    persistResearchEvents(events);
    setGenerationIndex(nextGenerationIndex); setCandidateIds(nextIds); setCells(nextCells);
  }

  function toggleKeep(id) {
    if (!parent) return;
    if (borrowMode && donor != null) { borrow(id, donor); return; }
    const next = new Set(kept); next.has(id) ? next.delete(id) : next.add(id);
    setKept(next);
    regenerateForControl(next, `${kept.has(id) ? 'released' : 'kept'}:${id}`);
  }

  function borrow(featureId, tileIndex) {
    if (!parent || !cells[tileIndex]) return;
    const next = new Set(kept); next.add(featureId);
    setKept(next); setDonor(null); setBorrowMode(false);
    const borrowedGenome = borrowFeature(domain, parent, cells[tileIndex], featureId);
    const sourceId = candidateIds[tileIndex] || '';
    const derivedId = studySession ? `${studySession.session_id}-B${String(studySession.events.length + 1).padStart(4, '0')}` : '';
    advanceDesign(borrowedGenome, Math.max(strength, 0.12), next, {
      trailId: derivedId,
      controlAction: `borrow:${featureId}`,
      controlCandidateId: sourceId,
      controlSelectedId: derivedId,
      controlGenome: borrowedGenome,
      extra: { borrowed: featureId },
    });
  }

  function back(i) {
    const g = trail[i];
    setTrail(trail.slice(0, i));
    setTrailCandidateIds(trailCandidateIds.slice(0, i));
    setTrailGenerationIndices(trailGenerationIndices.slice(0, i));
    advanceDesign(g, 0.15, kept, {
      selectedId: trailCandidateIds[i] || '',
      selectedGeneration: trailGenerationIndices[i] ?? generationIndex,
      trailId: trailCandidateIds[i] || '',
    });
  }

  function openRender(design, candidateId = '') {
    setRender({ design, result: null, candidateId });
    setRenderError('');
  }

  async function runRender(rendererId, prompt) {
    if (!render) return;
    if (rendererId !== 'flux-kontext' && rendererId !== 'meshy-text' && rendererId !== 'tripo-api' && rendererId !== 'hunyuan3d' && rendererId !== 'trellis') {
      const selected = renderers.find((renderer) => renderer.id === rendererId);
      setRenderError(`${selected?.name || 'This renderer'} is not connected yet. You can copy its prompt to use it separately.`);
      return;
    }
    persistResearchEvents([{
      event_type: 'render', generation_index: generationIndex,
      product_category: categoryFor(domain), candidate_id: render.candidateId,
      selected_candidate_id: render.candidateId, genome_parameters: render.design,
      renderer_id: rendererId,
    }]);
    setRendering(true); setRenderError(''); setRenderProgress(0);
    try {
      const { design } = render;
      const result = await connectFalRenderer({ domain, design, prompt, rendererId });
      setRender((r) => (r && r.design === design ? { ...r, result } : r));
    } catch (error) {
      setRenderError(error.message || 'FLUX rendering failed.');
    } finally {
      setRendering(false);
    }
  }
  function tileClick(e, g, i) {
    if (borrowMode) { setDonor(i); return; }
    const box = e.currentTarget.getBoundingClientRect();
    advanceDesign(g, 0.04 + (1 - (e.clientY - box.top) / box.height) * 0.34, kept, {
      selectedId: candidateIds[i] || '',
      selectedGeneration: generationIndex,
      trailId: candidateIds[i] || '',
    });     // top of the tile = wild, bottom = fine
  }

  function saveResearchRatings(similarity, control) {
    if (!studySession || !lastSelection || researchError) return;
    persistResearchEvents([
      {
        event_type: 'rated', rating_type: 'similarity',
        generation_index: lastSelection.generationIndex,
        product_category: categoryFor(domain), candidate_id: lastSelection.id,
        selected_candidate_id: lastSelection.id, genome_parameters: lastSelection.genome,
        similarity_rating: similarity,
      },
      {
        event_type: 'rated', rating_type: 'control',
        generation_index: generationIndex, product_category: categoryFor(domain),
        selected_candidate_id: lastSelection.id, control_rating: control,
      },
    ]);
  }

  function endStudy() {
    if (!studySession) return;
    const startCategory = studySession.events.find((event) => event.event_type === 'start')?.product_category || 'other';
    try {
      const completed = finishSession(
        studySession,
        generationIndex,
        domain ? categoryFor(domain) : startCategory,
      );
      setStudySession(null);
      setCompletedSessions((sessions) => [...sessions.filter((item) => item.session_id !== completed.session_id), completed]);
      setConsentGiven(false); setConsentChecked(false); setResearchError('');
      setDomain(null); setCells([]); setCandidateIds([]); setTrail([]);
      setTrailCandidateIds([]); setTrailGenerationIndices([]); setLastSelection(null);
      setRender(null); setDonor(null); setBorrowMode(false);
    } catch (error) {
      setResearchError(`Could not finish and save this session: ${error.message || 'browser storage unavailable'}.`);
    }
  }

  const researchControls = (
    <ResearchControls
      studyMode={studyMode}
      session={studySession}
      completedSessions={completedSessions}
      error={researchError}
      onEnd={endStudy}
    />
  );

  // Keys 1 to 9 keep or free a feature.
  useEffect(() => {
    const onKey = (e) => {
      const n = Number(e.key);
      if (domain && !render && n >= 1 && n <= domain.features.length) toggleKeep(domain.features[n - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Scripted states for screenshots: add ?demo=tops, ?demo=keep, or ?demo=render to the address.
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (!demo || studyMode) return;
    const d = demo === 'tops' ? domains[1] : domains[0];
    const g0 = { ...randomGenome(d), ...(d.id === 'vessels' ? { handle: 0.8, spout: 0.2 } : {}) };
    const keptDemo = new Set(demo === 'keep' ? ['handle', 'color'] : []);
    const g1 = mutate(d, g0, 0.1), g2 = mutate(d, g1, 0.05);
    setDomain(d); setTrail([g0, g1, g2]); setKept(keptDemo);
    setCells(nextGeneration(d, g2, demo === 'keep' ? 0.36 : 0.2, keptDemo, COUNT));
    if (demo === 'render') setRender({ design: g2, result: null });
  }, []);

  if (!domain) {
    if (studyMode && !consentGiven) {
      return (
        <main>
          <header><h1>Design Evolution Explorer</h1></header>
          {researchControls}
          <section className="research-consent" aria-labelledby="research-title">
            <h2 id="research-title">Research study</h2>
            <p>
              If you participate, this study records design choices, design parameter values,
              ratings, and timestamps in this browser. The study log is not sent to the
              rendering API and can be downloaded by the researcher after the session.
            </p>
            <p>
              If you choose an AI renderer, the selected sketch and prompt are sent to fal
              through the rendering service. You can use the site without joining the study.
            </p>
            <label className="research-consent-check">
              <input type="checkbox" checked={consentChecked}
                onChange={(event) => setConsentChecked(event.target.checked)} />
              <span>I have read this information and agree to participate.</span>
            </label>
            <div className="row research-consent-actions">
              <button type="button" className="primary"
                disabled={!consentChecked || Boolean(researchError)}
                onClick={() => setConsentGiven(true)}>
                Continue to study
              </button>
              <button type="button" onClick={continueWithoutStudy}>
                Continue without study logging
              </button>
            </div>
          </section>
        </main>
      );
    }
    return (
      <main>
        <header><h1>Design Evolution Explorer</h1></header>
        {researchControls}
        <p className="status">Step 1 of 3. What do you want to design?</p>
        <Chooser domains={domains} samples={samples} onChoose={start} />
      </main>
    );
  }

  if (render) {
    return (
      <main>
        <header><h1>Design Evolution Explorer</h1><span className="where">{domain.name}</span></header>
        {researchControls}
        <p className="status">Step 3 of 3. Render it, then download the result or go back and keep evolving.</p>
        <RenderStep domain={domain} design={render.design} result={render.result}
          rendering={rendering} progress={renderProgress} error={renderError}
          onAgain={runRender}
          onBack={() => setRender(null)} />
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>Design Evolution Explorer</h1><span className="where">{domain.name}</span>
        <div className="row">
          <button type="button" aria-pressed={borrowMode} onClick={() => { setBorrowMode(!borrowMode); setDonor(null); }}>Borrow a feature</button>
          <button type="button" disabled={!parent} className="primary" onClick={() => openRender(parent, trailCandidateIds[trailCandidateIds.length - 1] || '')}>Render this</button>
          <button type="button" onClick={() => start(domain)}>Start over</button>
          <button type="button" onClick={() => setDomain(null)}>Change category</button>
        </div>
      </header>
      {researchControls}
      <p className="status">
        {borrowMode ? (donor == null ? 'Click the tile that has the feature you want.' : 'Now click the chip for that feature.')
          : 'Step 2 of 3. Click the one closest to the design in your head. Click high on a tile for wild children, low for close ones. Right-click a tile to render it.'}
      </p>
      <div className="board">
        <div className="grid">
          {cells.map((g, i) => (
            <Sketch key={i} domain={domain} genome={g} labels draggable
              className={`paper tile${parent && i === 0 ? ' parent' : ''}${donor === i ? ' donor' : ''}`}
              onClick={(e) => tileClick(e, g, i)}
              onContextMenu={(e) => { e.preventDefault(); openRender(g, candidateIds[i] || ''); }}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'copy'; }} />
          ))}
        </div>
        <aside>
          <KeepPanel domain={domain} parent={parent} trail={trail} kept={kept} borrowing={borrowMode && donor != null}
            onToggle={toggleKeep} onDropTile={borrow} />
          {studySession && lastSelection && (
            <ResearchRatings
              key={`${generationIndex}-${lastSelection.id}`}
              generationIndex={generationIndex}
              selectedGenerationIndex={lastSelection.generationIndex}
              onSave={saveResearchRatings}
            />
          )}
          <Trail domain={domain} trail={trail} onBack={back} />
        </aside>
      </div>
    </main>
  );
}
