import React, { useEffect, useRef, useState } from 'react';
import { featureSample, isSteady } from './engine.js';
import { renderers } from './renderers.js';

// One drawing. The canvas is drawn at twice its layout size so it stays sharp on a retina screen.
export function Sketch({ domain, genome, px = 150, labels = false, className = '', ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    domain.draw(ref.current, genome, { labels });
  }, [domain, genome, labels]);
  return <canvas ref={ref} width={px * 2} height={px * 2} className={className} {...rest} />;
}

export function Chooser({ domains, samples, onChoose }) {
  return (
    <div className="chooser">
      {domains.map((d) => (
        <button key={d.id} type="button" className="card" onClick={() => onChoose(d)}>
          <div className="card-row">
            {samples[d.id].map((g, i) => <Sketch key={i} domain={d} genome={g} px={90} />)}
          </div>
          <div className="card-name">{d.name}</div>
          <div className="card-blurb">{d.blurb}</div>
        </button>
      ))}
    </div>
  );
}

export function KeepPanel({ domain, parent, trail, kept, borrowing, onToggle, onDropTile }) {
  const names = domain.features.filter((f) => kept.has(f.id)).map((f) => f.name.toLowerCase());
  const hint = !parent ? 'Make a first pick, then keep what you like.'
    : borrowing ? 'Now click the chip for the feature you want from that tile.'
    : names.length ? `Kept: ${names.join(', ')}. Everything else keeps changing.`
    : 'Click a chip to keep that feature. Drag a tile onto a chip to borrow its feature.';
  return (
    <section>
      <div className="label">Keep</div>
      <p className="hint">{hint}</p>
      <div className="keep">
        {domain.features.map((f, n) => {
          const isKept = kept.has(f.id), steady = parent && isSteady(f, trail);
          const none = parent && f.none && f.none(parent);
          return (
            <button key={f.id} type="button" disabled={!parent}
              className={`chip${isKept ? ' kept' : ''}${steady && !isKept ? ' steady' : ''}`}
              onClick={() => onToggle(f.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onDropTile(f.id, Number(e.dataTransfer.getData('text/plain'))); }}>
              <Sketch domain={domain} genome={featureSample(domain, f, parent)} px={56} />
              <div className="chip-name">{n + 1}. {f.name}{none ? ' (none)' : ''}</div>
              <div className="chip-state">{isKept ? 'KEPT (click to free)' : steady ? 'steady: keep it?' : 'changing'}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Trail({ domain, trail, onBack }) {
  return (
    <section>
      <div className="label">Trail <span className="count">picks: {trail.length}</span></div>
      <div className="crumbs">
        {trail.map((g, i) => (
          <Sketch key={i} domain={domain} genome={g} px={46} className="crumb" title={`Go back to pick ${i + 1}`} onClick={() => onBack(i)} />
        ))}
      </div>
    </section>
  );
}

// The render step. One big frame for the rendered design, with a Download button under it.
// No generator is connected yet: connectRenderer() in App.jsx is the one place to add it.
// Until it returns a result, the frame shows the sketch and Download saves the sketch as a PNG.
export function RenderStep({ domain, design, result, rendering, progress, error, onAgain, onBack }) {
  const [rendererId, setRendererId] = useState(renderers[0].id);
  const [copied, setCopied] = useState(false);
  const frame = useRef(null);
  const renderer = renderers.find((r) => r.id === rendererId);
  const prompt = renderer.buildPrompt(domain, design);
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  const save = (href, filename) => {
    const a = document.createElement('a');
    a.href = href; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const download = () => {
    if (result) { save(result.url, result.filename || `${domain.id}-render`); return; }
    const canvas = frame.current && frame.current.querySelector('canvas');
    if (canvas) save(canvas.toDataURL('image/png'), `${domain.id}-sketch.png`);
  };
  return (
    <div className="render">
      <div className="render-left">
        <div className="label">Your design</div>
        <Sketch domain={domain} genome={design} px={260} labels className="paper big" />
        <label className="label" htmlFor="renderer">Renderer</label>
        <select id="renderer" value={rendererId} onChange={(e) => setRendererId(e.target.value)}>
          {renderers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <p className="hint">Sends {renderer.sends}. Gives back a {renderer.output}.</p>
        {renderer.id === 'meshy-text' && <p className="hint">Meshy 7.1 returns a textured 3D model.</p>}
        <div className="label">Prompt for this renderer</div>
        <p className="prompt" id="prompt-text">{prompt}</p>
        <div className="row">
          <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy prompt'}</button>
          <button type="button" onClick={onBack}>Back to evolving</button>
        </div>
      </div>
      <div className="render-right">
        <div className="label">Rendered version</div>
        <p className="hint">
          {result ? `Made with ${renderer.name}.` : rendering ? renderer.id === 'meshy-text' ? 'Meshy is creating your 3D model…' : renderer.id === 'hunyuan3d' ? 'Hunyuan is creating your 3D model…' : renderer.id === 'tripo-api' ? 'Tripo via fal is creating your 3D model…' : 'FLUX is turning your sketch into a rendered product image…' : 'Render the sketch with the selected model.'}
        </p>
        <figure className="result" ref={frame}>
          {result && result.kind === 'image'
            ? <img src={result.url} alt="Rendered design" />
            : result
              ? <div className="paper model-note">{result.previewUrl && <img src={result.previewUrl} alt="3D model preview" />}<span>3D model ready. Download the model file to view or use it in a 3D application.</span></div>
              : <Sketch domain={domain} genome={design} px={520} className="paper" />}
          <figcaption>
            <button type="button" className="primary" onClick={download}>{result?.kind === 'model' ? 'Download 3D model' : result ? 'Download' : 'Download sketch (PNG)'}</button>
            <button type="button" onClick={() => onAgain(rendererId, prompt)} disabled={rendering}>{rendering ? 'Rendering…' : result ? 'Render again' : 'Render'}</button>
          </figcaption>
        </figure>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
