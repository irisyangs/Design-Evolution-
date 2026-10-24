import React, { useEffect, useMemo, useState } from 'react';
import { domains } from './domains/index.js';
import { randomGenome, nextGeneration, mutate, borrowFeature } from './engine.js';
import { Sketch, Chooser, KeepPanel, Trail, RenderStep } from './components.jsx';
import { renderers } from './renderers.js';

const COUNT = 36;

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
  const response = await fetch('/api/flux-render', {
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
    filename: data.filename || `${domain.id}-${rendererId === 'meshy-text' ? 'meshy-model.glb' : rendererId === 'trellis' ? 'trellis-model.glb' : rendererId === 'tripo-api' ? 'tripo-model.glb' : 'flux-render.png'}`,
  };
}

async function connectDirectTripo({ domain, design, onProgress }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1040;
  canvas.height = 1040;
  domain.draw(canvas, design, { labels: false });
  const createResponse = await fetch('/api/tripo-direct-render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: canvas.toDataURL('image/png') }),
  });
  const created = await createResponse.json();
  if (!createResponse.ok) throw new Error(created.error || 'Could not start direct Tripo task.');
  if (!created.task_id) throw new Error('Tripo did not return a task ID.');

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await fetch(`/api/tripo-direct-render/${encodeURIComponent(created.task_id)}`);
    const task = await response.json();
    if (!response.ok) throw new Error(task.error || 'Could not check direct Tripo task status.');
    onProgress(task.progress || 0);
    if (task.status === 'success') {
      if (!task.output?.model_url) throw new Error('Tripo finished without a downloadable model.');
      return {
        kind: 'model',
        url: task.output.model_url,
        previewUrl: task.output.rendered_image_url,
        filename: `${domain.id}-tripo-direct-model.glb`,
      };
    }
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(task.error_message || `Tripo task ${task.status}.`);
    }
  }
  throw new Error('Tripo is still processing. Try rendering again in a moment.');
}

export default function App() {
  const [domain, setDomain] = useState(null);
  const [cells, setCells] = useState([]);
  const [trail, setTrail] = useState([]);
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

  function start(d) {
    setDomain(d); setTrail([]); setKept(new Set()); setRender(null); setLog([]); setDonor(null); setBorrowMode(false);
    setCells(Array.from({ length: COUNT }, () => randomGenome(d)));
  }
  function pick(g, s, keptNow = kept, extra = {}) {
    setStrength(s);
    setTrail((t) => [...t, g]);
    setCells(nextGeneration(domain, g, s, keptNow, COUNT));
    setLog((l) => [...l, { t: Date.now(), strength: s, genome: g, kept: [...keptNow], ...extra }]);
  }
  function toggleKeep(id) {
    if (!parent) return;
    if (borrowMode && donor != null) { borrow(id, donor); return; }
    const next = new Set(kept); next.has(id) ? next.delete(id) : next.add(id);
    setKept(next);
    setCells(nextGeneration(domain, parent, Math.max(strength, 0.12), next, COUNT));   // regrow at once, so the change shows
  }
  function borrow(featureId, tileIndex) {
    if (!parent || !cells[tileIndex]) return;
    const next = new Set(kept); next.add(featureId);
    setKept(next); setDonor(null); setBorrowMode(false);
    pick(borrowFeature(domain, parent, cells[tileIndex], featureId), Math.max(strength, 0.12), next, { borrowed: featureId });
  }
  function back(i) {
    const g = trail[i];
    setTrail(trail.slice(0, i));
    pick(g, 0.15);
  }
  function openRender(design) {
    setRender({ design, result: null });
    setRenderError('');
  }
  async function runRender(rendererId, prompt) {
    if (!render) return;
    if (rendererId !== 'flux-kontext' && rendererId !== 'meshy-text' && rendererId !== 'tripo-api' && rendererId !== 'tripo-direct-api' && rendererId !== 'trellis') {
      const selected = renderers.find((renderer) => renderer.id === rendererId);
      setRenderError(`${selected?.name || 'This renderer'} is not connected yet. You can copy its prompt to use it separately.`);
      return;
    }
    setRendering(true); setRenderError(''); setRenderProgress(0);
    try {
      const { design } = render;
      const result = rendererId === 'tripo-direct-api'
        ? await connectDirectTripo({ domain, design, onProgress: setRenderProgress })
        : await connectFalRenderer({ domain, design, prompt, rendererId });
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
    pick(g, 0.04 + (1 - (e.clientY - box.top) / box.height) * 0.34);     // top of the tile = wild, bottom = fine
  }

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
    if (!demo) return;
    const d = demo === 'tops' ? domains[1] : domains[0];
    const g0 = { ...randomGenome(d), ...(d.id === 'vessels' ? { handle: 0.8, spout: 0.2 } : {}) };
    const keptDemo = new Set(demo === 'keep' ? ['handle', 'color'] : []);
    const g1 = mutate(d, g0, 0.1), g2 = mutate(d, g1, 0.05);
    setDomain(d); setTrail([g0, g1, g2]); setKept(keptDemo);
    setCells(nextGeneration(d, g2, demo === 'keep' ? 0.36 : 0.2, keptDemo, COUNT));
    if (demo === 'render') setRender({ design: g2, result: null });
  }, []);

  if (!domain) {
    return (
      <main>
        <header><h1>Design Evolution Explorer</h1></header>
        <p className="status">Step 1 of 3. What do you want to design?</p>
        <Chooser domains={domains} samples={samples} onChoose={start} />
      </main>
    );
  }

  if (render) {
    return (
      <main>
        <header><h1>Design Evolution Explorer</h1><span className="where">{domain.name}</span></header>
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
          <button type="button" disabled={!parent} className="primary" onClick={() => openRender(parent)}>Render this</button>
          <button type="button" onClick={() => start(domain)}>Start over</button>
          <button type="button" onClick={() => setDomain(null)}>Change category</button>
        </div>
      </header>
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
              onContextMenu={(e) => { e.preventDefault(); openRender(g); }}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'copy'; }} />
          ))}
        </div>
        <aside>
          <KeepPanel domain={domain} parent={parent} trail={trail} kept={kept} borrowing={borrowMode && donor != null}
            onToggle={toggleKeep} onDropTile={borrow} />
          <Trail domain={domain} trail={trail} onBack={back} />
        </aside>
      </div>
    </main>
  );
}
