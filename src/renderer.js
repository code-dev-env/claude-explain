const $ = id => document.getElementById(id);
const fmt = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};

/* ---------- prompt ---------- */
const DETAIL = {
  beginner: 'Write for a beginner: plain words, define terms, use analogies.',
  intermediate: 'Write for a working programmer new to this code: explain intent and structure, skip basic syntax.',
  expert: 'Write for an expert: be concise and focus on architecture, non-obvious behaviour and risks.'
};

const LIM = {
  full: { concepts: '3-6', steps: '4-9', comps: 'up to 16', nodes: '5-14', seq: '6-14 messages; use null if the file has no meaningful interaction between parts', notes: '0-5', len: '' },
  quick: { concepts: '2-3', steps: '3-5', comps: 'up to 8', nodes: '4-8', seq: 'ALWAYS null in quick mode', notes: '0-2', len: 'QUICK MODE: be brief. Keep every description to one short sentence and the overview to 2 sentences.' }
};

function systemPrompt() {
  const L = LIM[opts.mode];
  return `You analyze one source file and reply with ONLY a single JSON object: no markdown fences, no commentary before or after.
${DETAIL[opts.detail]}
${L.len}
The file is given with line numbers in the form "12| code". Use those numbers for every "lines" value ([startLine, endLine], integers).
In any text field you may use \`backticks\` around identifiers and **bold** for emphasis, nothing else.

Schema, emit keys in exactly this order:
{
 "title": "short human title for what this file is (max 6 words)",
 "tagline": "one punchy sentence",
 "complexity": "simple" | "moderate" | "complex",
 "overview": "2-4 sentences: what the file does, why, and how it fits together",
 "concepts": [ {"name": "...", "description": "1-2 sentences"} ],            // ${L.concepts} key ideas/patterns/libraries
 "walkthrough": [ {"title": "...", "description": "2-3 sentences", "lines": [a,b]} ],   // ${L.steps} steps in logical reading order
 "components": [ {"name": "exact identifier", "kind": "function"|"class"|"module"|"constant", "summary": "1 sentence", "lines": [a,b], "calls": ["names of OTHER listed components it calls or uses"]} ],   // ${L.comps} most important
 "flow": { "title": "...", "caption": "1 sentence", "nodes": [ {"id": "short id", "label": "max 40 chars", "type": "start"|"process"|"decision"|"io"|"end", "lines": [a,b]} ], "edges": [ {"from": "id", "to": "id", "label": "optional, e.g. yes/no"} ] },   // main runtime flow, ${L.nodes} nodes, one start. Loops may point back to an earlier node.
 "sequence": null | { "title": "...", "caption": "...", "participants": ["max 6 names"], "messages": [ {"from": "participant", "to": "participant", "text": "max 40 chars", "kind": "call"|"return"} ] },   // ${L.seq}
 "notes": [ {"severity": "info"|"tip"|"warn"|"bug", "text": "..."} ]            // ${L.notes} gotchas, risks, improvements
}
Every flow edge must reference existing node ids. Every name in "calls" must exactly match another component's "name". Output must be valid JSON.`;
}

/* ---------- options (mode + detail), shared by landing and header ---------- */
const opts = {
  mode: store.get('mode') === 'quick' ? 'quick' : 'full',
  detail: ['beginner', 'intermediate', 'expert'].includes(store.get('detail')) ? store.get('detail') : 'intermediate'
};
const MODE_HINT = {
  full: 'Full: complete walkthrough, all five diagram types and notes (about 15–25 s).',
  quick: 'Quick: short summary, a smaller flowchart and call graph, fewer tokens and a faster answer.'
};
function syncOpts() {
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === opts.mode));
  $('landDetail').value = opts.detail; $('hdrDetail').value = opts.detail; $('hdrMode').value = opts.mode;
  $('modeHint').textContent = MODE_HINT[opts.mode];
}
function setOpt(k, v) { opts[k] = v; store.set(k, v); syncOpts(); }
$('modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setOpt('mode', b.dataset.mode); });
$('landDetail').onchange = e => setOpt('detail', e.target.value);
$('hdrDetail').onchange = e => setOpt('detail', e.target.value);
$('hdrMode').onchange = e => setOpt('mode', e.target.value);

/* ---------- state ---------- */
let file = null, local = null, result = null, running = false, reqId = 0;
let timer = 0, t0 = 0, streamedChars = 0, lastStats = null;

function showView(name) {
  ['landing', 'loading', 'errorView', 'result'].forEach(v => { $(v).hidden = v !== name; });
  const hasFile = !!file;
  $('againBtn').hidden = !hasFile || name === 'loading';
  $('hdrOpts').hidden = !hasFile || name === 'loading';
  $('fileChip').hidden = !hasFile;
  $('runStats').hidden = !(name === 'result' && lastStats);
}

/* ---------- file loading ---------- */
async function tryLoad(fn) {
  if (running) return;
  try {
    const f = await fn();
    if (f) { file = f; local = analyzeSource(f.name, f.content); analyze(); }
  } catch (e) {
    showError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

$('openBtn').onclick = () => tryLoad(() => window.api.openFile());
$('dropzone').onclick = () => tryLoad(() => window.api.openFile());
$('dropzone').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('dropzone').click(); });
$('againBtn').onclick = () => file && analyze();
$('errRetry').onclick = () => (file ? analyze() : showView('landing'));
$('errSettings').onclick = () => openSettings();

let dragDepth = 0;
addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; if (!running) $('dropOverlay').hidden = false; });
addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true;
  const f = e.dataTransfer.files[0];
  if (f) tryLoad(() => window.api.readFile(window.api.pathForFile(f)));
});

/* ---------- analysis run ---------- */
const STAGES = [
  ['"overview"', 'Understanding the purpose'],
  ['"concepts"', 'Extracting key concepts'],
  ['"walkthrough"', 'Writing the walkthrough'],
  ['"components"', 'Mapping functions & classes'],
  ['"flow"', 'Drawing the flowchart'],
  ['"sequence"', 'Tracing interactions'],
  ['"notes"', 'Spotting gotchas']
];

function fmtTime(ms) {
  const s = ms / 1000;
  return s < 60 ? s.toFixed(1) + 's' : Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's';
}
const fmtTok = n => (n == null ? '–' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n >= 1000 ? (n / 1000).toFixed(2) + 'k' : String(n));

function setStages(text) {
  const seen = STAGES.map(([k]) => text.includes(k));
  let last = seen.lastIndexOf(true);
  $('stages').innerHTML = STAGES.map(([, label], i) => {
    const cls = i < last || (!running && i === last) ? 'done' : i === last ? 'active' : (i === last + 1 && running ? '' : '');
    const state = i < last ? 'done' : i === last ? 'active' : '';
    return `<li class="${state || cls}"><span class="s-ic">✓</span>${esc(label)}</li>`;
  }).join('');
}

async function analyze() {
  running = true; result = null; lastStats = null;
  const id = ++reqId;
  let text = '';
  streamedChars = 0;
  $('loadFile').textContent = file.name;
  $('fileName').textContent = file.name;
  $('fileLang').textContent = local.lang;
  $('liveTime').textContent = '0.0s'; $('liveTok').textContent = '0';
  setStages('');
  showView('loading');
  t0 = performance.now();
  clearInterval(timer);
  timer = setInterval(() => {
    $('liveTime').textContent = fmtTime(performance.now() - t0);
    $('liveTok').textContent = '≈ ' + fmtTok(Math.round(streamedChars / 3.6));
  }, 100);

  const numbered = local.lines.map((l, i) => `${i + 1}| ${l}`).join('\n');
  const res = await window.api.stream({
    id, system: systemPrompt(),
    messages: [{ role: 'user', content: `Analyze this file: ${file.name}\n\n<file name="${file.name}">\n${numbered}\n</file>` }]
  }, d => { text += d; streamedChars += d.length; setStages(text); });

  clearInterval(timer);
  const elapsed = performance.now() - t0;
  running = false;

  if (res.cancelled) return showView(result ? 'result' : 'landing');
  if (res.error) return showError(res.error);

  const parsed = parseJSON(text);
  if (!parsed) return showError('Claude replied, but the answer was not in the expected format. Trying again usually fixes this.', text);
  result = normalize(parsed);
  lastStats = { elapsed, meta: res.meta || {}, mode: opts.mode, detail: opts.detail };
  renderResult();
}

function parseJSON(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

function normalize(r) {
  const arr = v => (Array.isArray(v) ? v : []);
  const range = v => {
    if (Array.isArray(v) && Number.isFinite(+v[0])) return [Math.max(1, +v[0]), Math.max(+v[0], +(v[1] ?? v[0]))];
    return null;
  };
  return {
    title: r.title || file.name, tagline: r.tagline || '', complexity: ['simple', 'moderate', 'complex'].includes(r.complexity) ? r.complexity : 'moderate',
    overview: r.overview || '',
    concepts: arr(r.concepts), notes: arr(r.notes),
    walkthrough: arr(r.walkthrough).map(s => ({ ...s, lines: range(s.lines) })),
    components: arr(r.components).filter(c => c && c.name).map(c => ({ ...c, lines: range(c.lines), calls: arr(c.calls) })),
    flow: r.flow && arr(r.flow.nodes).length ? { ...r.flow, nodes: r.flow.nodes.map(n => ({ ...n, lines: range(n.lines) })) } : null,
    sequence: r.sequence && arr(r.sequence.messages).length ? r.sequence : null
  };
}

function showError(msg, raw) {
  clearInterval(timer); running = false;
  $('errMsg').textContent = msg;
  $('errRaw').hidden = !raw;
  $('errRaw').textContent = raw || '';
  showView('errorView');
}

$('cancelBtn').onclick = () => window.api.cancel(reqId);

/* ---------- result ---------- */
let activeTab = 'overview';

function renderResult() {
  // run stats
  const m = lastStats.meta;
  $('stTime').textContent = fmtTime(lastStats.elapsed);
  $('stIn').textContent = fmtTok(m.inputTokens);
  $('stOut').textContent = fmtTok(m.outputTokens);
  $('stModel').textContent = (m.model || '').replace(/^claude-/, '') || '–';
  $('stInPill').title = `Input tokens: ${m.inputTokens ?? 'n/a'}${m.cachedTokens ? ` (${m.cachedTokens} read from cache)` : ''}\nOutput tokens: ${m.outputTokens ?? 'n/a'}\nVia: ${m.source || ''}${m.costUsd != null ? `\nEstimated API cost: $${m.costUsd.toFixed(4)}` : ''}`;
  $('stModelPill').title = m.model || '';

  $('codeMeta').textContent = `${local.lang} · ${local.total} lines`;
  const frag = document.createDocumentFragment();
  local.lines.forEach((l, i) => {
    const d = document.createElement('div');
    d.className = 'ln' + (local.types[i] === 'm' ? ' cm' : '');
    d.id = 'L' + (i + 1);
    const n = document.createElement('i'); n.textContent = i + 1;
    d.append(n, document.createTextNode(l || ' '));
    frag.appendChild(d);
  });
  $('codeBody').replaceChildren(frag);
  clearHighlight();
  showView('result');
  setTab('overview');
}

function highlight(range) {
  if (!range) return;
  clearHighlight(true);
  const [a, b] = range, max = local.total;
  for (let n = Math.max(1, a); n <= Math.min(b, max); n++) $('L' + n)?.classList.add('hl');
  $('L' + Math.min(Math.max(1, a), max))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  $('clearHl').hidden = false;
}
function clearHighlight(keep) {
  document.querySelectorAll('.ln.hl').forEach(e => e.classList.remove('hl'));
  if (!keep) $('clearHl').hidden = true;
}
$('clearHl').onclick = () => { clearHighlight(); document.querySelectorAll('.step.active').forEach(e => e.classList.remove('active')); };

$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const html = { overview: tabOverview, walkthrough: tabWalkthrough, diagrams: tabDiagrams, components: tabComponents }[tab]();
  $('tabBody').innerHTML = `<div class="tabpage">${html}</div>`;
  $('tabBody').scrollTop = 0;
  if (tab === 'diagrams') fitAll();
  if (tab === 'components') bindComponentFilters();
}

const rangeChip = r => (r ? `<span class="lines" data-lines="[${r[0]},${r[1]}]">Lines ${r[0]}${r[1] !== r[0] ? '–' + r[1] : ''} ↗</span>` : '');

function tabOverview() {
  const r = result, L = local;
  const pct = n => (L.total ? Math.round((n / L.total) * 100) : 0);
  const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  return `
  <div class="card2 summary">
    <h2>${esc(r.title)}</h2>
    <div class="tag">${fmt(r.tagline)}</div>
    <p>${fmt(r.overview)}</p>
    <div class="badges"><span class="badge">${esc(L.lang)}</span><span class="badge cx-${r.complexity}">${r.complexity[0].toUpperCase() + r.complexity.slice(1)} complexity</span><span class="badge">${esc(file.name)}</span><span class="badge">${lastStats.mode === 'quick' ? '⚡ Quick' : 'Full'} · ${lastStats.detail}</span></div>
  </div>
  <div class="grid4">
    ${stat(L.total.toLocaleString(), 'total lines')}
    ${stat(L.code.toLocaleString(), `lines of code · ${pct(L.code)}%`)}
    ${stat(pct(L.comment) + '%', 'comments')}
    ${stat(r.components.length, 'components')}
    ${stat(r.flow ? r.flow.nodes.length : '–', 'flow steps')}
  </div>
  ${r.concepts.length ? `<div class="sec">Key concepts</div><div class="grid2">${r.concepts.map((c, i) => `<div class="concept"><div class="n">${i + 1}</div><h4>${fmt(c.name)}</h4><p>${fmt(c.description)}</p></div>`).join('')}</div>` : ''}
  ${r.notes.length ? `<div class="sec">Worth knowing</div>${r.notes.map(n => {
    const sev = ['info', 'tip', 'warn', 'bug'].includes(n.severity) ? n.severity : 'info';
    return `<div class="note ${sev}"><span class="gl">${{ info: 'ℹ', tip: '✦', warn: '⚠', bug: '✖' }[sev]}</span><div>${fmt(n.text)}</div></div>`;
  }).join('')}` : ''}`;
}

function tabWalkthrough() {
  const w = result.walkthrough;
  if (!w.length) return '<div class="empty">No walkthrough was produced.</div>';
  return `<div class="timeline">${w.map((s, i) => `
    <div class="step" data-lines="${s.lines ? `[${s.lines[0]},${s.lines[1]}]` : ''}">
      <div class="num">${i + 1}</div>
      <div class="body"><h4>${fmt(s.title)}</h4><p>${fmt(s.description)}</p>${rangeChip(s.lines)}</div>
    </div>`).join('')}</div>`;
}

function dcard(title, sub, svg, extra = '', key = '') {
  return `<div class="card2 dcard">
    ${svg ? `<div class="toolbar" data-for="${key}"><button data-z="out" title="Zoom out">−</button><button data-z="fit" title="Fit">⤢</button><button data-z="in" title="Zoom in">+</button><button data-z="max" title="Expand">⛶</button></div>` : ''}
    <h3>${esc(title)}</h3><p class="sub">${fmt(sub || '')}</p>
    ${svg ? `<div class="canvas" id="cv-${key}">${svg}</div>` : '<div class="empty">Not applicable for this file.</div>'}${extra}
  </div>`;
}

function tabDiagrams() {
  const r = result, L = local;
  const flow = r.flow ? flowchartSVG(r.flow) : null;
  const calls = callgraphSVG(r.components);
  const seq = r.sequence ? sequenceSVG(r.sequence) : null;
  const fmap = filemapSVG(r.components, L.total, L.types);
  const donut = donutSVG([
    { v: L.code, cls: 's-code', label: 'Code' }, { v: L.comment, cls: 's-com', label: 'Comments' }, { v: L.blank, cls: 's-blank', label: 'Blank' }
  ], L.total.toLocaleString(), 'lines');
  const comp = `<div class="comp-wrap" style="margin-bottom:18px">${donut}<div class="legend" style="flex-direction:column;gap:8px">
      <span><i style="background:var(--a1)"></i>Code — ${L.code}</span><span><i style="background:var(--a2)"></i>Comments — ${L.comment}</span><span><i style="background:var(--edge)"></i>Blank — ${L.blank}</span>
      <span>Deepest nesting — ${Math.round(L.maxIndent / 4)} levels</span><span>Longest line — ${L.longest} chars</span></div></div>`;
  const legend = `<div class="legend"><span><i style="background:var(--k-function)"></i>function</span><span><i style="background:var(--k-class)"></i>class</span><span><i style="background:var(--k-module)"></i>module</span><span><i style="background:var(--k-constant)"></i>constant</span><span>Click any node to jump to its code</span></div>`;
  return dcard(r.flow?.title || 'Program flow', r.flow?.caption || 'The main path through the code.', flow, '', 'flow')
    + dcard('Architecture & call graph', 'How the main functions and classes use each other.', calls, legend, 'calls')
    + dcard(r.sequence?.title || 'Interaction sequence', r.sequence?.caption || 'Who talks to whom, in order.', seq, '', 'seq')
    + dcard('File map & composition', 'Where each component lives in the file, plus a breakdown of code vs comments.', fmap, '', 'fmap').replace('<div class="canvas"', comp + '<div class="canvas"');
}

function fitAll() {
  document.querySelectorAll('.canvas svg').forEach(svg => setScale(svg, null));
}
function setScale(svg, s) {
  const w = +svg.dataset.w, h = +svg.dataset.h, avail = svg.parentElement.clientWidth - 16;
  if (s == null) s = Math.min(1.15, avail / w);
  s = Math.min(Math.max(s, 0.25), 3);
  svg.dataset.s = s;
  svg.setAttribute('width', Math.round(w * s)); svg.setAttribute('height', Math.round(h * s));
}

function tabComponents() {
  const comps = result.components;
  if (!comps.length) return '<div class="empty">No components were identified.</div>';
  const kinds = [...new Set(comps.map(c => c.kind || 'function'))];
  return `<div class="filters"><input id="cSearch" placeholder="Search components…"><button class="fbtn on" data-kind="">All ${comps.length}</button>${kinds.map(k => `<button class="fbtn" data-kind="${esc(k)}">${esc(k)}</button>`).join('')}</div><div class="cgrid" id="cGrid"></div>`;
}
function bindComponentFilters() {
  const comps = result.components;
  let kind = '';
  const draw = () => {
    const q = $('cSearch')?.value.toLowerCase() || '';
    const list = comps.filter(c => (!kind || (c.kind || 'function') === kind) && (c.name + ' ' + (c.summary || '')).toLowerCase().includes(q));
    $('cGrid').innerHTML = list.map(c => {
      const k = ['function', 'class', 'module', 'constant'].includes(c.kind) ? c.kind : 'function';
      return `<div class="ccard" data-lines="${c.lines ? `[${c.lines[0]},${c.lines[1]}]` : ''}">
        <div class="hd"><span class="kind k-${k}">${k}</span><h4 class="mono">${esc(c.name)}</h4></div>
        <p>${fmt(c.summary)}</p>${rangeChip(c.lines)}
        ${c.calls.length ? `<div class="calls" style="margin-top:8px">uses ${c.calls.map(x => `<code>${esc(x)}</code>`).join('')}</div>` : ''}
      </div>`;
    }).join('') || '<div class="empty">No matches.</div>';
  };
  draw();
  $('cSearch')?.addEventListener('input', draw);
  document.querySelectorAll('.fbtn').forEach(b => b.onclick = () => {
    kind = b.dataset.kind;
    document.querySelectorAll('.fbtn').forEach(x => x.classList.toggle('on', x === b));
    draw();
  });
}

/* clicks anywhere in the dashboard that carry line ranges */
$('tabBody').addEventListener('click', e => {
  const z = e.target.closest('[data-z]');
  if (z) {
    const key = z.parentElement.dataset.for, svg = document.querySelector(`#cv-${key} svg`);
    if (!svg) return;
    if (z.dataset.z === 'max') return openViewer(svg, z.closest('.dcard').querySelector('h3').textContent);
    if (z.dataset.z === 'fit') return setScale(svg, null);
    return setScale(svg, +svg.dataset.s * (z.dataset.z === 'in' ? 1.25 : 0.8));
  }
  const el = e.target.closest('[data-lines]');
  if (!el || !el.dataset.lines) return;
  try { highlight(JSON.parse(el.dataset.lines)); } catch { return; }
  const step = el.closest('.step');
  document.querySelectorAll('.step.active').forEach(s => s.classList.remove('active'));
  step?.classList.add('active');
});

/* ---------- expanded diagram viewer: wheel zoom, drag to pan, fit / 100% ---------- */
const viewer = { svg: null, w: 0, h: 0, s: 1 };
const zc = $('zoomCanvas');
function vApply(s, anchor) {
  s = Math.min(Math.max(s, 0.1), 6);
  const old = viewer.s, sl = zc.scrollLeft, st = zc.scrollTop;
  viewer.s = s;
  viewer.svg.setAttribute('width', Math.round(viewer.w * s)); viewer.svg.setAttribute('height', Math.round(viewer.h * s));
  $('zoomPct').textContent = Math.round(s * 100) + '%';
  if (anchor) { // keep the point under the cursor fixed
    const k = s / old;
    zc.scrollLeft = (sl + anchor.x) * k - anchor.x; zc.scrollTop = (st + anchor.y) * k - anchor.y;
  }
}
function vFit() {
  const pad = 40;
  vApply(Math.min((zc.clientWidth - pad) / viewer.w, (zc.clientHeight - pad) / viewer.h, 1));
  zc.scrollLeft = 0; zc.scrollTop = 0;
}
function openViewer(svg, title) {
  zc.innerHTML = svg.outerHTML;
  viewer.svg = zc.querySelector('svg');
  viewer.w = +viewer.svg.dataset.w; viewer.h = +viewer.svg.dataset.h;
  $('zoomTitle').textContent = title;
  $('zoomModal').hidden = false;
  vFit();
}
const vStep = f => vApply(viewer.s * f, { x: zc.clientWidth / 2, y: zc.clientHeight / 2 });
$('zIn').onclick = () => vStep(1.25);
$('zOut').onclick = () => vStep(0.8);
$('zFit').onclick = vFit;
$('z100').onclick = () => vApply(1);
$('zClose').onclick = () => { $('zoomModal').hidden = true; };
$('zoomModal').addEventListener('mousedown', e => { if (e.target === $('zoomModal')) $('zoomModal').hidden = true; });
zc.addEventListener('wheel', e => {
  e.preventDefault();
  const r = zc.getBoundingClientRect();
  vApply(viewer.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12), { x: e.clientX - r.left, y: e.clientY - r.top });
}, { passive: false });
zc.addEventListener('mousedown', e => {
  const sx = e.clientX, sy = e.clientY, l = zc.scrollLeft, t = zc.scrollTop;
  zc.classList.add('drag');
  const move = ev => { zc.scrollLeft = l - (ev.clientX - sx); zc.scrollTop = t - (ev.clientY - sy); };
  const up = () => { zc.classList.remove('drag'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
});
addEventListener('resize', () => { if (!$('zoomModal').hidden) vFit(); });

/* ---------- theme & settings ---------- */
function applyTheme(t) { document.documentElement.dataset.theme = t; store.set('theme', t); }
applyTheme(store.get('theme') || 'dark');
$('themeBtn').onclick = () => { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); };

async function openSettings() {
  const s = await window.api.getSettings();
  $('keyInput').value = '';
  $('keyState').textContent = s.hasKey ? '(a key is saved)' : '(not set)';
  $('modelInput').value = s.model;
  $('modeInput').value = s.mode;
  $('cliInput').value = s.cliPath;
  $('settingsModal').hidden = false;
}
$('settingsBtn').onclick = openSettings;
$('settingsCancel').onclick = () => { $('settingsModal').hidden = true; };
$('settingsSave').onclick = async () => {
  const patch = { model: $('modelInput').value.trim() || 'claude-sonnet-5-5', mode: $('modeInput').value, cliPath: $('cliInput').value.trim() };
  const key = $('keyInput').value.trim();
  if (key) patch.apiKey = key;
  await window.api.setSettings(patch);
  $('settingsModal').hidden = true;
};
addEventListener('keydown', e => { if (e.key === 'Escape') { $('zoomModal').hidden = true; $('settingsModal').hidden = true; } });

$('resizer').addEventListener('mousedown', e => {
  e.preventDefault();
  const move = ev => { $('codePane').style.width = Math.min(Math.max(ev.clientX, 240), innerWidth - 420) + 'px'; };
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); if (activeTab === 'diagrams') fitAll(); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
});

syncOpts();
showView('landing');
