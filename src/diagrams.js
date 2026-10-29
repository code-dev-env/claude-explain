// Custom SVG diagram engine — hand-built layout + rendering (no external diagram library).
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function wrapText(text, max) {
  const words = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      out.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  if (cur) out.push(cur);
  return out
    .slice(0, 4)
    .map((l, i, a) =>
      i === 3 && words.join(" ").length > max * 4
        ? l.slice(0, max - 1) + "…"
        : l,
    );
}

/* ---------- layered graph layout ---------- */
function layeredLayout(
  nodes,
  edges,
  { gapX = 36, gapY = 64, maxRow = 1100 } = {},
) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  edges = edges.filter(
    (e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to,
  );
  const out = new Map(nodes.map((n) => [n.id, []]));
  const incoming = new Set();
  edges.forEach((e) => {
    out.get(e.from).push(e);
    incoming.add(e.to);
  });

  // DFS: find back edges (cycles) and an ordering
  const state = new Map(),
    order = [],
    post = [];
  const back = new Set();
  const dfs = (id) => {
    state.set(id, 1);
    order.push(id);
    for (const e of out.get(id)) {
      const s = state.get(e.to);
      if (s === 1) back.add(e);
      else if (!s) dfs(e.to);
    }
    state.set(id, 2);
    post.push(id);
  };
  const roots = nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  [...roots, ...nodes.map((n) => n.id)].forEach((id) => {
    if (!state.get(id)) dfs(id);
  });

  // longest-path layering over forward edges
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  [...post].reverse().forEach((id) => {
    for (const e of out.get(id))
      if (!back.has(e))
        layer.set(e.to, Math.max(layer.get(e.to), layer.get(id) + 1));
  });
  const nl = Math.max(0, ...layer.values()) + 1;
  const rows = Array.from({ length: nl }, () => []);
  order.forEach((id) => rows[layer.get(id)].push(id));

  // barycentre ordering sweeps
  const pos = new Map();
  const setPos = () =>
    rows.forEach((r) => r.forEach((id, i) => pos.set(id, i)));
  setPos();
  const preds = new Map(nodes.map((n) => [n.id, []])),
    succs = new Map(nodes.map((n) => [n.id, []]));
  edges
    .filter((e) => !back.has(e))
    .forEach((e) => {
      preds.get(e.to).push(e.from);
      succs.get(e.from).push(e.to);
    });
  const bary = (id, nb) => {
    const a = nb.get(id);
    return a.length
      ? a.reduce((s, x) => s + pos.get(x), 0) / a.length
      : pos.get(id);
  };
  for (let k = 0; k < 4; k++) {
    for (let i = 1; i < nl; i++) {
      rows[i].sort((a, b) => bary(a, preds) - bary(b, preds));
      setPos();
    }
    for (let i = nl - 2; i >= 0; i--) {
      rows[i].sort((a, b) => bary(a, succs) - bary(b, succs));
      setPos();
    }
  }

  // wrap very wide rows into sub-rows
  const finalRows = [];
  rows.forEach((r) => {
    let cur = [],
      w = 0;
    r.forEach((id) => {
      const nw = byId.get(id).w + gapX;
      if (cur.length && w + nw > maxRow) {
        finalRows.push(cur);
        cur = [];
        w = 0;
      }
      cur.push(id);
      w += nw;
    });
    if (cur.length) finalRows.push(cur);
  });

  const widths = finalRows.map(
    (r) => r.reduce((s, id) => s + byId.get(id).w, 0) + gapX * (r.length - 1),
  );
  const W = Math.max(...widths, 200);
  let y = 0;
  finalRows.forEach((r, ri) => {
    const h = Math.max(...r.map((id) => byId.get(id).h));
    let x = (W - widths[ri]) / 2;
    r.forEach((id) => {
      const n = byId.get(id);
      n.x = x;
      n.y = y + (h - n.h) / 2;
      x += n.w + gapX;
    });
    y += h + gapY;
  });
  return { nodes, edges, back, width: W, height: y - gapY };
}

function edgePath(a, b, isBack) {
  if (isBack) {
    const x1 = a.x + a.w,
      y1 = a.y + a.h / 2,
      x2 = b.x + b.w,
      y2 = b.y + b.h / 2;
    const off = 56 + Math.abs(y1 - y2) * 0.04;
    const mx = Math.max(x1, x2) + off;
    return {
      d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,
      lx: mx - 6,
      ly: (y1 + y2) / 2,
    };
  }
  const x1 = a.x + a.w / 2,
    y1 = a.y + a.h,
    x2 = b.x + b.w / 2,
    y2 = b.y;
  const d = Math.max(28, Math.abs(y2 - y1) / 2);
  const t = 0.5;
  const lx =
    (1 - t) ** 3 * x1 +
    3 * (1 - t) ** 2 * t * x1 +
    3 * (1 - t) * t * t * x2 +
    t ** 3 * x2;
  const ly =
    (1 - t) ** 3 * y1 +
    3 * (1 - t) ** 2 * t * (y1 + d) +
    3 * (1 - t) * t * t * (y2 - d) +
    t ** 3 * y2;
  return {
    d: `M${x1},${y1} C${x1},${y1 + d} ${x2},${y2 - d} ${x2},${y2}`,
    lx,
    ly,
  };
}

const DEFS = `<defs>
  <linearGradient id="gA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--a1)"/><stop offset="1" stop-color="var(--a2)"/></linearGradient>
  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="var(--edge)"/></marker>
  <marker id="arrB" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="var(--warn)"/></marker>
  <filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity=".22"/></filter>
</defs>`;

function svgWrap(w, h, inner, pad = 28) {
  const W = Math.ceil(w + pad * 2),
    H = Math.ceil(h + pad * 2);
  return `<svg class="dgm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" data-w="${W}" data-h="${H}" width="${W}" height="${H}">${DEFS}<g transform="translate(${pad},${pad})">${inner}</g></svg>`;
}

const geom = (n) =>
  `data-id="${esc(n.id)}" data-x="${n.x}" data-y="${n.y}" data-w="${n.w}" data-h="${n.h}"`;

/* ---------- flowchart ---------- */
function flowchartSVG(flow) {
  const CH = 7.1;
  const nodes = (flow.nodes || []).slice(0, 24).map((n) => {
    const type = ["start", "end", "decision", "io", "process"].includes(n.type)
      ? n.type
      : "process";
    const lines = wrapText(n.label, type === "decision" ? 18 : 26);
    const tw = Math.max(...lines.map((l) => l.length), 6) * CH;
    let w = Math.max(96, tw + 36),
      h = lines.length * 17 + 24;
    if (type === "decision") {
      w = w * 1.3 + 24;
      h = h * 1.45 + 14;
    }
    return {
      id: String(n.id),
      label: n.label,
      type,
      lines,
      w,
      h,
      lineRange: n.lines,
    };
  });
  if (!nodes.length) return null;
  const edges = (flow.edges || []).map((e) => ({
    from: String(e.from),
    to: String(e.to),
    label: e.label,
  }));
  const L = layeredLayout(nodes, edges, { gapX: 44, gapY: 54 });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let s = "";
  L.edges.forEach((e) => {
    const a = byId.get(e.from),
      b = byId.get(e.to),
      isBack = L.back.has(e);
    const p = edgePath(a, b, isBack);
    s += `<path d="${p.d}" class="edge${isBack ? " loop" : ""}" data-f="${esc(e.from)}" data-t="${esc(e.to)}" data-b="${isBack ? 1 : 0}" marker-end="url(#${isBack ? "arrB" : "arr"})"/>`;
    if (e.label) {
      const tw = String(e.label).length * 6.4 + 14;
      s += `<g class="elabel" data-f="${esc(e.from)}" data-t="${esc(e.to)}" data-b="${isBack ? 1 : 0}" data-lx="${p.lx}" data-ly="${p.ly}"><rect x="${p.lx - tw / 2}" y="${p.ly - 10}" width="${tw}" height="20" rx="10"/><text x="${p.lx}" y="${p.ly + 4}" text-anchor="middle">${esc(e.label)}</text></g>`;
    }
  });
  nodes.forEach((n) => {
    const cx = n.x + n.w / 2,
      cy = n.y + n.h / 2;
    let shape;
    if (n.type === "decision")
      shape = `<polygon points="${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}"/>`;
    else if (n.type === "start" || n.type === "end")
      shape = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2}"/>`;
    else if (n.type === "io")
      shape = `<polygon points="${n.x + 14},${n.y} ${n.x + n.w},${n.y} ${n.x + n.w - 14},${n.y + n.h} ${n.x},${n.y + n.h}"/>`;
    else
      shape = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12"/>`;
    const t = n.lines
      .map((l, i) => `<tspan x="${cx}" dy="${i ? 17 : 0}">${esc(l)}</tspan>`)
      .join("");
    const y0 = cy - ((n.lines.length - 1) * 17) / 2 + 4.5;
    const attr = n.lineRange
      ? ` data-lines="${esc(JSON.stringify(n.lineRange))}"`
      : "";
    s += `<g class="fnode movable t-${n.type}${n.lineRange ? " clickable" : ""}"${attr} ${geom(n)} filter="url(#sh)">${shape}<text x="${cx}" y="${y0}" text-anchor="middle">${t}</text><title>${esc(n.label)}</title></g>`;
  });
  return svgWrap(L.width + (L.back.size ? 70 : 0), L.height, s);
}

/* ---------- call graph / architecture ---------- */
function callgraphSVG(components) {
  const list = components.filter((c) => c && c.name).slice(0, 30);
  if (!list.length) return null;
  const idOf = new Map(list.map((c, i) => [c.name, "n" + i]));
  const nodes = list.map((c, i) => {
    const w = Math.max(132, Math.min(c.name.length, 24) * 7.6 + 54);
    return {
      id: "n" + i,
      name: c.name,
      kind: ["function", "class", "module", "constant"].includes(c.kind)
        ? c.kind
        : "function",
      w,
      h: 46,
      lineRange: c.lines,
    };
  });
  const edges = [];
  list.forEach((c, i) =>
    (c.calls || []).forEach((t) => {
      if (idOf.has(t)) edges.push({ from: "n" + i, to: idOf.get(t) });
    }),
  );
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const connected = nodes.filter((n) => linked.has(n.id));
  const alone = nodes.filter((n) => !linked.has(n.id));
  let s = "",
    W = 200,
    H = 0;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (connected.length) {
    const L = layeredLayout(connected, edges, { gapX: 34, gapY: 70 });
    W = L.width;
    H = L.height;
    L.edges.forEach((e) => {
      const isBack = L.back.has(e);
      s += `<path d="${edgePath(byId.get(e.from), byId.get(e.to), isBack).d}" class="edge${isBack ? " loop" : ""}" data-f="${e.from}" data-t="${e.to}" data-b="${isBack ? 1 : 0}" marker-end="url(#${isBack ? "arrB" : "arr"})"/>`;
    });
    if (L.back.size) W += 60;
  }
  if (alone.length) {
    const perRow = Math.max(3, Math.floor(Math.max(W, 760) / 170));
    const top = connected.length ? H + 64 : 0;
    if (connected.length)
      s += `<text x="0" y="${H + 40}" class="gcap">NO INTERNAL CALLS</text>`;
    alone.forEach((n, i) => {
      n.x = (i % perRow) * 168;
      n.y = top + Math.floor(i / perRow) * 62;
    });
    W = Math.max(W, Math.min(alone.length, perRow) * 168);
    H = top + Math.ceil(alone.length / perRow) * 62;
  }
  nodes.forEach((n) => {
    const label = n.name.length > 24 ? n.name.slice(0, 23) + "…" : n.name;
    const attr = n.lineRange
      ? ` data-lines="${esc(JSON.stringify(n.lineRange))}"`
      : "";
    s += `<g class="cnode movable k-${n.kind}${n.lineRange ? " clickable" : ""}"${attr} ${geom(n)} filter="url(#sh)"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12"/><circle cx="${n.x + 20}" cy="${n.y + n.h / 2}" r="5"/><text x="${n.x + 34}" y="${n.y + n.h / 2 + 4.5}" class="mono">${esc(label)}</text><title>${esc(n.name)} (${n.kind})</title></g>`;
  });
  return svgWrap(W, H, s);
}

/* ---------- sequence diagram ---------- */
function sequenceSVG(seq) {
  const parts = (seq.participants || []).slice(0, 8).map(String);
  const msgs = (seq.messages || [])
    .filter(
      (m) => parts.includes(String(m.from)) && parts.includes(String(m.to)),
    )
    .slice(0, 24);
  if (parts.length < 2 || !msgs.length) return null;
  const gap = Math.max(170, Math.min(230, 1000 / parts.length));
  const px = (i) => i * gap + 70;
  const top = 54,
    step = 54;
  const H = top + msgs.length * step + 30;
  let s = "";
  parts.forEach((p, i) => {
    const w = Math.max(104, p.length * 7.4 + 28);
    s += `<line class="life" x1="${px(i)}" y1="${top - 4}" x2="${px(i)}" y2="${H}"/>`;
    s += `<g class="pbox"><rect x="${px(i) - w / 2}" y="0" width="${w}" height="38" rx="12" filter="url(#sh)"/><text x="${px(i)}" y="23.5" text-anchor="middle">${esc(p)}</text></g>`;
  });
  msgs.forEach((m, k) => {
    const y = top + 26 + k * step;
    const a = parts.indexOf(String(m.from)),
      b = parts.indexOf(String(m.to));
    const ret = m.kind === "return";
    const label =
      String(m.text || "").length > 40
        ? String(m.text).slice(0, 39) + "…"
        : String(m.text || "");
    const tw = label.length * 6.5 + 14;
    if (a === b) {
      const x = px(a);
      s += `<path d="M${x},${y - 8} h34 v22 h-34" class="edge${ret ? " ret" : ""}" marker-end="url(#arr)"/>`;
      s += `<text class="mlabel" x="${x + 42}" y="${y + 6}">${esc(label)}</text>`;
    } else {
      const x1 = px(a) + (b > a ? 4 : -4),
        x2 = px(b) + (b > a ? -4 : 4),
        mx = (x1 + x2) / 2;
      s += `<path d="M${x1},${y} L${x2},${y}" class="edge${ret ? " ret" : ""}" marker-end="url(#arr)"/>`;
      s += `<g class="elabel"><rect x="${mx - tw / 2}" y="${y - 25}" width="${tw}" height="19" rx="9"/><text x="${mx}" y="${y - 11.5}" text-anchor="middle">${esc(label)}</text></g>`;
    }
    s += `<g class="seqn"><circle cx="${Math.min(px(a), px(b)) - 16 + (a === b ? 0 : 0)}" cy="${y}" r="9"/><text x="${Math.min(px(a), px(b)) - 16}" y="${y + 3.5}" text-anchor="middle">${k + 1}</text></g>`;
  });
  return svgWrap((parts.length - 1) * gap + 140, H, s);
}

/* ---------- file map: components laid out along the file ---------- */
function filemapSVG(components, total, types) {
  const comps = components
    .filter(
      (c) => Array.isArray(c.lines) && c.lines.length >= 1 && c.lines[0] > 0,
    )
    .slice(0, 24)
    .map((c) => ({ ...c, a: c.lines[0], b: c.lines[1] || c.lines[0] }))
    .sort((x, y) => x.a - y.a);
  if (!comps.length || !total) return null;
  const LBL = 190,
    BW = 640,
    RH = 30,
    TOP = 52;
  const X = (n) => LBL + ((n - 1) / total) * BW;
  let s = "";
  // density strip
  const segs = 96;
  for (let i = 0; i < segs; i++) {
    const a = Math.floor((i / segs) * total),
      b = Math.max(a + 1, Math.floor(((i + 1) / segs) * total));
    let code = 0,
      com = 0;
    for (let j = a; j < b; j++) {
      if (types[j] === "c") code++;
      else if (types[j] === "m") com++;
    }
    const n = b - a,
      d = code / n,
      c = com / n;
    s += `<rect x="${LBL + (i / segs) * BW}" y="0" width="${BW / segs + 0.5}" height="22" class="${c > 0.5 ? "seg-m" : "seg-c"}" style="opacity:${(c > 0.5 ? 0.35 + c * 0.6 : 0.12 + d * 0.88).toFixed(2)}"/>`;
  }
  s += `<text x="${LBL - 14}" y="15" text-anchor="end" class="gcap">CODE DENSITY</text>`;
  [1, Math.round(total / 2), total].forEach((n) => {
    s += `<text x="${X(n)}" y="${TOP - 12}" text-anchor="${n === total ? "end" : n === 1 ? "start" : "middle"}" class="gcap">L${n}</text>`;
  });
  comps.forEach((c, i) => {
    const y = TOP + i * RH;
    const kind = ["function", "class", "module", "constant"].includes(c.kind)
      ? c.kind
      : "function";
    const x = X(c.a),
      w = Math.max(6, X(c.b + 1) - x);
    const name = c.name.length > 26 ? c.name.slice(0, 25) + "…" : c.name;
    s += `<line class="grid" x1="${LBL}" y1="${y + RH - 3}" x2="${LBL + BW}" y2="${y + RH - 3}"/>`;
    s += `<text x="${LBL - 14}" y="${y + 16}" text-anchor="end" class="mono flabel">${esc(name)}</text>`;
    s += `<g class="bar k-${kind} clickable" data-lines="${esc(JSON.stringify([c.a, c.b]))}"><rect x="${x}" y="${y + 3}" width="${w}" height="${RH - 10}" rx="7" filter="url(#sh)"/><title>${esc(c.name)} · lines ${c.a}–${c.b}</title></g>`;
  });
  return svgWrap(LBL + BW + 10, TOP + comps.length * RH, s);
}

/* ---------- donut ---------- */
function donutSVG(parts, centerTop, centerBottom) {
  const R = 62,
    C = 2 * Math.PI * R,
    tot = parts.reduce((s, p) => s + p.v, 0) || 1;
  let off = 0,
    s = `<circle cx="90" cy="90" r="${R}" class="donut-bg"/>`;
  parts.forEach((p) => {
    const len = (p.v / tot) * C;
    s += `<circle cx="90" cy="90" r="${R}" class="donut-seg ${p.cls}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"><title>${esc(p.label)}: ${p.v}</title></circle>`;
    off += len;
  });
  s += `<text x="90" y="88" text-anchor="middle" class="dnum">${esc(centerTop)}</text><text x="90" y="108" text-anchor="middle" class="dcap">${esc(centerBottom)}</text>`;
  return `<svg class="donut" viewBox="0 0 180 180" width="180" height="180">${s}</svg>`;
}
