/* Redundant Path Planner: front end.
   Every path shown here comes from the Python API (/api/...), which runs
   redundant_dijkstra.py, the same routing file as the notebook. This script
   only draws the answers and handles clicks. */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (x, d = 1) => (x === null || x === undefined ? "∞"
  : Number(x).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }));
const natural = (a, b) => String(a).localeCompare(String(b), "en", { numeric: true });
const linkKey = (a, b) => [String(a), String(b)].sort(natural).join("|");

const S = {
  nets: [], net: "nigeria", data: null, from: null, to: null, tab: "route",
  route: null, cuts: [], cutRes: null, trace: null, step: 1, playing: false, timer: null,
  nextPick: "from", installMs: 50, showCosts: false, results: null, check: null,
};
const cache = { net: {}, route: {}, trace: {} };

/* ------------------------------------------------------------------ API */
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch (e) { /* not JSON */ }
    throw new Error(msg);
  }
  return res.json();
}
function showError(e) {
  const box = $("#error");
  box.textContent = e ? `Something went wrong: ${e.message || e}. Please try again.` : "";
  box.hidden = !e;
}
async function getNetwork(id) {
  if (!cache.net[id]) cache.net[id] = await api(`/api/network/${id}`);
  return cache.net[id];
}
async function getRoute() {
  const k = `${S.net}|${S.from}|${S.to}`;
  if (!cache.route[k]) {
    const q = new URLSearchParams({ net: S.net, source: S.from, target: S.to });
    cache.route[k] = await api(`/api/route?${q}`);
  }
  return cache.route[k];
}
async function getTrace() {
  const k = `${S.net}|${S.from}`;
  if (!cache.trace[k]) {
    const q = new URLSearchParams({ net: S.net, source: S.from });
    cache.trace[k] = await api(`/api/trace?${q}`);
  }
  return cache.trace[k];
}
async function getCut() {
  return api("/api/cut", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ net: S.net, source: S.from, target: S.to, cut: S.cuts.map((k) => k.split("|")) }),
  });
}

/* --------------------------------------------------------------- the map */
// Where to put a node's name so labels do not collide (default: right).
const LABEL_POS = {
  nigeria: { "Port Harcourt": "bl", Owerri: "l", Lagos: "b", Ibadan: "t", Katsina: "t", Sokoto: "t",
             Kano: "r", Kaduna: "l", Minna: "l", Abuja: "bl", Lokoja: "bl", Calabar: "r", Enugu: "r",
             "Benin City": "b", Ilorin: "l", Maiduguri: "t", Yola: "b", Makurdi: "b", Jos: "r", Bauchi: "t" },
  abuja: { Garki: "l", Asokoro: "b", Wuse: "t", Maitama: "b", Jabi: "t", Gwarinpa: "t" },
};

// The drawing uses real screen pixels (1 unit = 1 px), so text stays readable
// on a phone and on a wide screen. It is redrawn when the window is resized.
function geometry(d) {
  const W = Math.max(300, Math.round($("#map").clientWidth || 800));
  const narrow = W < 560;
  const PAD = narrow ? 44 : 68;
  const maxX = Math.max(...d.nodes.map((n) => n.x));
  const maxY = Math.max(...d.nodes.map((n) => n.y));
  const scale = (W - 2 * PAD) / Math.max(maxX, 0.0001);
  const H = Math.round(maxY * scale + 2 * PAD);
  const pos = {};
  for (const n of d.nodes) pos[n.id] = [PAD + n.x * scale, PAD + n.y * scale];
  return { W, H, pos, narrow };
}

const narrowMap = () => ($("#map").clientWidth || 800) < 560;

function labelAttrs(net, id, x, y, r, fs) {
  const p = (LABEL_POS[net] || {})[id] || "r";
  const g = r + 5;
  switch (p) {
    case "l": return { x: x - g, y: y + fs * 0.36, a: "end", up: false };
    case "t": return { x: x, y: y - g - 1, a: "middle", up: true };
    case "b": return { x: x, y: y + g + fs * 0.8, a: "middle", up: false };
    case "bl": return { x: x - g + 3, y: y + g + fs * 0.55, a: "end", up: false };
    default: return { x: x + g, y: y + fs * 0.36, a: "start", up: false };
  }
}

function polyline(pos, path, cls) {
  if (!path || path.length < 2) return "";
  const pts = path.map((n) => pos[n].map((v) => v.toFixed(1)).join(",")).join(" ");
  return `<polyline class="${cls}" points="${pts}"/>`;
}

/* opts: overlays [{path, cls}], tree [[u,v]], shared [[u,v]], cuts Set, clickableLinks,
         nodeClass(id) -> string, nodeDist(id) -> string|null */
function renderMap(opts = {}) {
  const d = S.data;
  const { W, H, pos, narrow } = geometry(d);
  const big = d.nodes.length > 25;
  const r = big ? (narrow ? 4.5 : 6) : (narrow ? 6 : 7.5);
  const fs = narrow || big ? 11.5 : 13.5;
  const parts = [`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(d.label)} map" class="${narrow ? "narrow" : ""} ${big ? "small-labels" : ""}">`];

  // links
  for (const l of d.links) {
    const [x1, y1] = pos[l.u], [x2, y2] = pos[l.v];
    parts.push(`<line class="lk" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  }
  (opts.shared || []).forEach(([u, v]) => parts.push(polyline(pos, [u, v], "p-shared")));
  (opts.faint || []).forEach((p) => parts.push(polyline(pos, p, "p-faint")));
  (opts.tree || []).forEach(([u, v]) => parts.push(polyline(pos, [u, v], "p-tree")));
  (opts.overlays || []).forEach((o) => parts.push(polyline(pos, o.path, o.cls)));

  // cut links
  const cuts = opts.cuts || new Set();
  for (const l of d.links) {
    if (!cuts.has(linkKey(l.u, l.v))) continue;
    const [x1, y1] = pos[l.u], [x2, y2] = pos[l.v];
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, s = 8;
    parts.push(`<line class="cut-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`,
      `<circle class="cut-x-bg" cx="${mx}" cy="${my}" r="13"/>`,
      `<path class="cut-x" d="M${mx - s / 1.6} ${my - s / 1.6}L${mx + s / 1.6} ${my + s / 1.6}M${mx + s / 1.6} ${my - s / 1.6}L${mx - s / 1.6} ${my + s / 1.6}"/>`);
  }

  // link costs
  if (S.showCosts) {
    for (const l of d.links) {
      const [x1, y1] = pos[l.u], [x2, y2] = pos[l.v];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      let ox = -(y2 - y1) / len, oy = (x2 - x1) / len;      // unit vector at right angles to the link
      if (oy > 0) { ox = -ox; oy = -oy; }                   // keep the label on the upper side
      const off = narrow ? 8 : 10;
      parts.push(`<text class="cost-lbl" x="${((x1 + x2) / 2 + ox * off).toFixed(1)}" y="${((y1 + y2) / 2 + oy * off + 4).toFixed(1)}" text-anchor="middle">${esc(nf(l.weight, dec()))}</text>`);
    }
  }

  // clickable link hit areas (cut mode)
  if (opts.clickableLinks) {
    for (const l of d.links) {
      const [x1, y1] = pos[l.u], [x2, y2] = pos[l.v];
      const k = linkKey(l.u, l.v);
      const label = `${l.u} to ${l.v}${cuts.has(k) ? " (cut, click to repair)" : " (click to cut)"}`;
      parts.push(`<line class="lk-hit" data-link="${esc(k)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><title>${esc(label)}</title></line>`,
        `<line class="lk-hover" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    }
  }

  // nodes
  for (const n of d.nodes) {
    const [x, y] = pos[n.id];
    const cls = ["nd", opts.nodeClass ? opts.nodeClass(n.id) : "", opts.markTwo && n.degree === 2 ? "two" : ""].join(" ");
    const la = labelAttrs(d.id, n.id, x, y, r, fs);
    const dist = opts.nodeDist ? opts.nodeDist(n.id) : null;
    parts.push(`<g class="${cls}" data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(n.id)}">`,
      `<circle cx="${x}" cy="${y}" r="${r}"/>`,
      `<text x="${la.x}" y="${la.y}" text-anchor="${la.a}">${esc(n.id)}</text>`);
    if (dist !== null) parts.push(`<text class="dist" x="${la.x}" y="${la.y + (la.up ? -1 : 1) * (fs + 1)}" text-anchor="${la.a}">${esc(dist)}</text>`);
    parts.push(`<title>${esc(n.id)}: ${n.degree} links</title></g>`);
  }
  parts.push("</svg>");
  $("#map").innerHTML = parts.join("");
}

function legend(items) {
  const sw = {
    primary: `<svg width="28" height="8"><line x1="2" y1="4" x2="26" y2="4" stroke="#222" stroke-width="5" stroke-linecap="round"/></svg>`,
    backup: `<svg width="28" height="8"><line x1="2" y1="4" x2="26" y2="4" stroke="#EB6834" stroke-width="4" stroke-dasharray="7 5" stroke-linecap="round"/></svg>`,
    rerun: `<svg width="28" height="8"><line x1="2" y1="4" x2="26" y2="4" stroke="#2A78D6" stroke-width="5" stroke-linecap="round"/></svg>`,
    faint: `<svg width="28" height="8"><line x1="2" y1="4" x2="26" y2="4" stroke="#222" stroke-opacity=".22" stroke-width="3"/></svg>`,
    cut: `<svg width="22" height="22"><circle cx="11" cy="11" r="9" fill="#fff" stroke="#B42318" stroke-width="2"/><path d="M7 7l8 8M15 7l-8 8" stroke="#B42318" stroke-width="2.4" stroke-linecap="round"/></svg>`,
    shared: `<svg width="28" height="12"><line x1="3" y1="6" x2="25" y2="6" stroke="#B42318" stroke-opacity=".25" stroke-width="10" stroke-linecap="round"/></svg>`,
    tree: `<svg width="28" height="8"><line x1="2" y1="4" x2="26" y2="4" stroke="#14213D" stroke-width="4" stroke-linecap="round"/></svg>`,
    settled: `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="#14213D" stroke="#14213D" stroke-width="2"/></svg>`,
    current: `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="#EB6834" stroke="#14213D" stroke-width="2"/></svg>`,
    frontier: `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="#F7D9A8" stroke="#8A5300" stroke-width="2"/></svg>`,
    unreached: `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="#fff" stroke="#14213D" stroke-width="2"/></svg>`,
    two: `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="#fff" stroke="#14213D" stroke-width="2" stroke-dasharray="3 2"/></svg>`,
  };
  $("#legend").innerHTML = items.map(([k, t]) => `<span>${sw[k]}${esc(t)}</span>`).join("");
}

/* --------------------------------------------------------------- helpers */
function pathHtml(path) {
  if (!path) return `<p class="muted">No path.</p>`;
  return `<div class="path">${path.map((n, i) => `${i ? '<span class="arr">→</span>' : ""}<span class="hop">${esc(n)}</span>`).join("")}</div>`;
}
const ICON = {
  good: `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M6 10.5l2.6 2.6L14.2 7.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  warn: `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.8l8.6 15.4H1.4z" fill="currentColor"/><path d="M10 7.5v4.6M10 14.6v.2" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
  bad: `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M6.8 6.8l6.4 6.4M13.2 6.8l-6.4 6.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
};
const status = (kind, html) => `<div class="status ${kind}">${ICON[kind]}<div>${html}</div></div>`;
const unit = () => S.data.unit;
const dec = () => (S.data.id === "nigeria" ? 1 : 0);   // km to 1 decimal; whole-number costs elsewhere
const pairKey = (path) => path.slice(0, -1).map((n, i) => linkKey(n, path[i + 1]));

/* ------------------------------------------------------------ route tab */
function renderRoute() {
  const r = S.route, d = S.data, s = d.summary;
  $("#mapTitle").textContent = `${S.from} to ${S.to}`;
  $("#mapHint").textContent = `Tip: click a node to set ${S.nextPick === "from" ? "From" : "To"}.`;
  renderMap({
    overlays: [{ path: r.primary, cls: "p-primary" }, { path: r.backup, cls: "p-backup" }],
    shared: r.shared, markTwo: true,
    nodeClass: (id) => (id === S.from || id === S.to ? "end" : ""),
  });
  const leg = [["primary", "Primary path (Pass 1)"], ["backup", "Backup path (Pass 2)"]];
  if (r.shared.length) leg.push(["shared", "Link both paths share"]);
  leg.push(["two", "Node with only two links"]);
  legend(leg);

  const pct = (100 * (r.backup_cost / r.primary_cost - 1)).toFixed(0);
  const sharedTxt = r.shared.map((l) => l.join(" - ")).join(", ");
  const traps = s.not_separate.map((p) =>
    `<button class="chip-btn" data-pair="${esc(p.source)}|${esc(p.target)}">${esc(p.source)} to ${esc(p.target)}</button>`).join("");
  const rulesX = (s.rules_both / s.rules_primary).toFixed(2);

  $("#panel").innerHTML = `
    <div class="card">
      <h2>${esc(S.from)} to ${esc(S.to)}</h2>
      <div class="kpis">
        <div class="kpi"><div class="k-label"><span class="swatch"></span>Primary cost</div>
          <div class="k-value">${nf(r.primary_cost, dec())}</div><div class="k-sub">${esc(unit())}, ${r.primary_hops} hops</div></div>
        <div class="kpi"><div class="k-label"><span class="swatch backup"></span>Backup cost</div>
          <div class="k-value">${nf(r.backup_cost, dec())}</div><div class="k-sub">${esc(unit())}, ${r.backup_hops} hops, ${pct}% longer</div></div>
      </div>
      <div class="path-label"><span class="swatch"></span>Primary (Pass 1)</div>${pathHtml(r.primary)}
      <div class="path-label"><span class="swatch backup"></span>Backup (Pass 2)</div>${pathHtml(r.backup)}
      ${r.disjoint
        ? status("good", "<b>Fully separate.</b> The backup shares no link with the primary, so any single broken link on the primary is covered straight away.")
        : status("warn", `<b>Shares ${r.shared.length === 1 ? "one link" : r.shared.length + " links"}: ${esc(sharedTxt)}.</b> If that link breaks, both paths break and Dijkstra has to run again.`)}
      <p class="muted" style="margin-top:12px">Pass 2 added a penalty of ${nf(r.penalty, dec())} ${esc(unit())} (all link costs added together, plus one) to each primary link. The server ran both Dijkstra passes for this pair in ${nf(r.two_pass_ms, 3)} ms.</p>
    </div>
    <div class="card">
      <h3>${esc(d.short)}: the whole routing table</h3>
      <table class="mini">
        <tr><td>Nodes, links</td><td class="num">${s.nodes}, ${s.links}</td></tr>
        <tr><td>Pairs, each with a primary and a backup</td><td class="num">${s.pairs.toLocaleString("en-GB")}</td></tr>
        <tr><td>Pairs with a fully separate backup</td><td class="num">${s.fully_separate.toLocaleString("en-GB")} (${nf(s.fully_separate_pct, 2)}%)</td></tr>
        <tr><td>Median backup length / primary length</td><td class="num">${nf(s.median_stretch, 3)}</td></tr>
        <tr><td>Switch rules: primary only, then with backups</td><td class="num">${s.rules_primary.toLocaleString("en-GB")} → ${s.rules_both.toLocaleString("en-GB")} (×${rulesX})</td></tr>
        <tr><td>Time to build the whole table</td><td class="num">${nf(s.table_build_ms)} ms</td></tr>
      </table>
      ${s.not_separate.length
        ? `<p style="margin-top:12px"><b>Pairs whose backup shares a link (traps):</b> ${s.not_separate.every((p) => p.separate_pair_exists) ? "a fully separate pair of paths does exist for each, but two separate Dijkstra runs missed it." : ""}</p><div>${traps}</div>`
        : `<p style="margin-top:12px">Every pair got a fully separate backup.</p>`}
      ${s.two_link_nodes.length ? `<p class="muted" style="margin-top:10px">Nodes with only two links (${s.two_link_nodes.length}): ${esc([...s.two_link_nodes].sort(natural).join(", "))}. If both of their links break, no method can reach them.</p>` : ""}
    </div>`;
}

/* -------------------------------------------------------------- cut tab */
const INSTALL_CHOICES = [[50, "100 ms"], [150, "200 ms"], [250, "300 ms"], [450, "500 ms"]];

function interruption(kind, res) {
  const det = res.timing_model.detect_ms, comp = res.rerun_ms, inst = S.installMs;
  if (kind === "ok") return { total: 0, rows: [] };
  if (kind === "switch") return { total: det, rows: [["Notice the break", det], ["Switch to stored backup", 0]] };
  if (kind === "rerun") return { total: det + comp + inst, rows: [["Notice the break", det], ["Re-run Dijkstra (measured)", comp], ["Install new rules", inst]] };
  return { total: null, rows: [] };
}

function methodCard(title, m, res, isTwo) {
  const txt = {
    ok: status("good", "<b>Still working.</b> No cut link is on the primary path, so nothing changes."),
    switch: status("good", "<b>Switched to the stored backup.</b> As soon as the break is noticed, traffic moves to the backup. No new calculation is needed."),
    rerun: isTwo
      ? status("warn", "<b>Both stored paths are broken.</b> It falls back to running Dijkstra again, just like plain Dijkstra.")
      : status("bad", "<b>Primary broken. Traffic stops</b> until the break is noticed, Dijkstra runs again and the switches get new rules."),
    down: status("bad", "<b>No route exists at all.</b> The cuts split the network, so traffic waits until a link is repaired. No method can help here."),
  }[m.status];
  const t = interruption(m.status, res);
  const lost = t.total === null ? null : t.total / 20;   // one packet every 20 ms
  const timing = t.rows.length ? `<dl class="timing">${t.rows.map(([a, b]) => `<dt>${a}</dt><dd>${nf(b, b < 1 && b > 0 ? 3 : 0)} ms</dd>`).join("")}
      <dt class="total">Traffic interrupted</dt><dd class="total">${nf(t.total, 1)} ms</dd>
      <dt>Packets lost (one every 20 ms)</dt><dd>about ${nf(lost, 1)}</dd></dl>` : "";
  const sw = m.status === "switch" ? "backup" : m.status === "rerun" ? "rerun" : "";
  return `<div class="card method">
      <h3>${title}</h3>${txt}
      ${m.path ? `<div class="path-label" style="margin-top:12px"><span class="swatch ${sw}"></span>Path now carrying traffic, ${nf(m.cost, dec())} ${esc(unit())}</div>${pathHtml(m.path)}` : ""}
      ${timing}</div>`;
}

function renderCut() {
  const res = S.cutRes, cuts = new Set(S.cuts);
  $("#mapTitle").textContent = `Cut links between ${S.from} and ${S.to}`;
  $("#mapHint").textContent = "Click a link to cut it. Click it again to repair it.";
  const overlays = [], leg = [];
  if (res) {
    const p = res.plain, t = res.two_pass;
    if (p.status === "ok") {
      overlays.push({ path: p.path, cls: "p-primary" }); leg.push(["primary", "Primary still carrying traffic"]);
    } else {
      if (p.path) { overlays.push({ path: p.path, cls: "p-rerun" }); leg.push(["rerun", "Plain Dijkstra: path after the re-run"]); }
      if (t.status === "switch") { overlays.push({ path: t.path, cls: "p-backup" }); leg.push(["backup", "Two-pass: stored backup now in use"]); }
      else if (t.status === "rerun") leg.push(["rerun", "Two-pass also re-ran Dijkstra (same path)"]);
    }
  }
  leg.push(["faint", "Original primary path"], ["cut", "Cut link"]);
  renderMap({
    faint: res && res.primary ? [res.primary] : [],
    overlays, cuts, clickableLinks: true,
    nodeClass: (id) => (id === S.from || id === S.to ? "end" : ""),
  });
  legend(leg);

  const chips = S.cuts.length
    ? S.cuts.map((k) => `<button class="chip-btn" data-uncut="${esc(k)}" title="Repair this link">${esc(k.replace("|", " - "))} ×</button>`).join("")
    : `<span class="muted">No links cut yet.</span>`;
  let summary = "";
  if (res) {
    const a = interruption(res.plain.status, res).total, b = interruption(res.two_pass.status, res).total;
    if (a !== null && b !== null && a > b) {
      summary = status("good", `<b>Two-pass saves ${nf(a - b, 1)} ms of interruption</b> for this one flow, about ${nf((a - b) / 20, 1)} fewer lost packets. Added up over many cuts and many flows, this saving is what experiment E6 measured.`);
    } else if (res.plain.status === "ok") {
      summary = `<p class="muted">Cut a link on the primary path to see the difference.</p>`;
    } else if (a === b && a !== null) {
      summary = `<p class="muted">Both methods behave the same here, because both stored paths are broken.</p>`;
    }
  }
  $("#panel").innerHTML = `
    <div class="card">
      <h2>What happens when links break?</h2>
      <div class="btn-row">
        <button class="btn primary" id="cutPrimary">Cut a link on the primary</button>
        <button class="btn" id="cutClear" ${S.cuts.length ? "" : "disabled"}>Repair all</button>
      </div>
      <div>${chips}</div>
      <p class="muted" style="margin:12px 0 6px">Restoration time for a Dijkstra re-run (notice + re-run + install), the four settings tested in E6:</p>
      <div class="seg" role="group" aria-label="Restoration time setting">
        ${INSTALL_CHOICES.map(([v, l]) => `<button type="button" data-install="${v}" aria-pressed="${S.installMs === v}">${l}</button>`).join("")}
      </div>
    </div>
    ${res ? methodCard("Plain Dijkstra (one path)", res.plain, res, false) + methodCard("Two-pass Dijkstra (primary + backup)", res.two_pass, res, true) : `<div class="card loading">Working…</div>`}
    ${summary ? `<div class="card">${summary}</div>` : ""}`;
}

/* ------------------------------------------------------------ trace tab */
function renderTrace() {
  const tr = S.trace, steps = tr.steps, n = steps.length;
  const k = Math.min(Math.max(S.step, 1), n);
  const cur = steps[k - 1], prev = k > 1 ? steps[k - 2] : null;
  const settled = new Set(steps.slice(0, k).map((s) => s.settled));
  const tree = steps.slice(1, k).filter((s) => s.parent).map((s) => [s.parent, s.settled]);
  const tgtStep = steps.find((s) => s.settled === S.to);

  $("#mapTitle").textContent = `Dijkstra from ${S.from}: step ${k} of ${n}`;
  $("#mapHint").textContent = "Change the start with the From box, or click a node.";
  renderMap({
    tree,
    nodeClass: (id) => {
      if (id === cur.settled) return "current";
      if (settled.has(id)) return "settled";
      return cur.dist[id] !== null ? "frontier" : "";
    },
    nodeDist: (id) => (cur.dist[id] === null ? (narrowMap() ? null : "∞") : nf(cur.dist[id], dec())),
  });
  legend([["current", "Just settled"], ["settled", "Settled: cost is final"], ["frontier", "Reached: cost may still drop"],
    ["unreached", "Not reached yet (∞)"], ["tree", "Cheapest way in"]]);

  const updates = [];
  for (const id of Object.keys(cur.dist)) {
    const before = prev ? prev.dist[id] : (id === S.from ? null : null);
    const after = cur.dist[id];
    if (k === 1) { if (id !== S.from && after !== null) updates.push(`${esc(id)}: ∞ → ${nf(after, dec())}`); }
    else if (after !== before && after !== null && !settled.has(id)) updates.push(`${esc(id)}: ${before === null ? "∞" : nf(before, dec())} → ${nf(after, dec())}`);
  }
  const order = Object.keys(cur.dist).sort((a, b) => {
    const da = cur.dist[a] === null ? Infinity : cur.dist[a], db = cur.dist[b] === null ? Infinity : cur.dist[b];
    return da - db || natural(a, b);
  });
  const rows = order.map((id) => {
    const tag = id === cur.settled ? '<span class="tag c">Just settled</span>'
      : settled.has(id) ? '<span class="tag s">Settled</span>'
      : cur.dist[id] !== null ? '<span class="tag f">Reached</span>' : '<span class="tag u">Not reached</span>';
    return `<tr><td>${esc(id)}</td><td class="num">${cur.dist[id] === null ? "∞" : nf(cur.dist[id], dec())}</td><td>${tag}</td></tr>`;
  }).join("");

  const head = k === 1
    ? `Start at <b>${esc(S.from)}</b> with cost 0.`
    : `Settled <b>${esc(cur.settled)}</b> at ${nf(cur.cost, dec())} ${esc(unit())}, reached from ${esc(cur.parent)}.`;
  const tgtNote = tgtStep && k >= tgtStep.step
    ? status("good", `<b>${esc(S.to)} was settled at step ${tgtStep.step}</b> with cost ${nf(tgtStep.cost, dec())} ${esc(unit())}. That cost is final, so a run that only needs ${esc(S.to)} stops there.`)
    : "";

  $("#panel").innerHTML = `
    <div class="card">
      <div class="trace-controls">
        <button class="btn" data-step="first" title="First step" aria-label="First step">⏮</button>
        <button class="btn" data-step="prev" aria-label="Previous step">◀ Back</button>
        <button class="btn primary" data-step="play">${S.playing ? "Pause" : "Play"}</button>
        <button class="btn" data-step="next" aria-label="Next step">Next ▶</button>
        <button class="btn" data-step="last" title="Last step" aria-label="Last step">⏭</button>
        <input type="range" id="stepRange" min="1" max="${n}" value="${k}" aria-label="Step">
      </div>
      <p class="step-big">Step ${k} of ${n}</p>
      <p>${head}</p>
      ${updates.length ? `<p class="muted" style="margin-bottom:0">Cheaper costs found for its neighbours:</p><ul class="updates">${updates.map((u) => `<li>${u}</li>`).join("")}</ul>` : `<p class="muted">No neighbour got a cheaper cost this time.</p>`}
      ${tgtNote}
    </div>
    <div class="card">
      <h3>The rule Dijkstra follows</h3>
      <p>Always settle the reached node with the <b>smallest</b> cost so far. Its cost is now final, because every other way to it would start from a node that is already further away. Then look at its neighbours: if going through it is cheaper, write down the new cost.</p>
      <div class="scroll"><table class="mini"><thead><tr><th>Node</th><th class="num">Best cost so far</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  const range = $("#stepRange");
  range.addEventListener("input", () => { stopPlay(); S.step = Number(range.value); renderTrace(); });
}

function stopPlay() { S.playing = false; clearInterval(S.timer); S.timer = null; }
function stepCmd(cmd) {
  const n = S.trace.steps.length;
  if (cmd === "play") {
    if (S.playing) { stopPlay(); renderTrace(); return; }
    if (S.step >= n) S.step = 1;
    S.playing = true;
    S.timer = setInterval(() => {
      if (S.step >= n) { stopPlay(); renderTrace(); return; }
      S.step += 1; renderTrace();
    }, 1100);
    renderTrace(); return;
  }
  stopPlay();
  S.step = { first: 1, prev: Math.max(1, S.step - 1), next: Math.min(n, S.step + 1), last: n }[cmd];
  renderTrace();
}

/* ---------------------------------------------------------- results tab */
async function renderResults() {
  const el = $("#results");
  if (!S.results) {
    el.innerHTML = `<div class="loading">Loading results…</div>`;
    S.results = await api("/results/key_numbers.json");
  }
  const k = S.results;
  const e1pairs = k.e1.reduce((a, x) => a + x["pairs checked"], 0);
  const e2 = Object.fromEntries(k.e2.map((x) => [x.network.split(" ")[0], x]));
  const e3 = Object.fromEntries(k.e3.map((x) => [x.network, x]));
  const e4 = (net, kk, m) => k.e4.find((x) => x.network === net && x.k === kk && x.method === m);
  const e5 = Object.fromEntries(k.e5.map((x) => [x.network, x]));
  const sens = k.e6_sensitivity;
  const tiles = [
    ["E1 Correctness", "100%", `Dijkstra's costs matched NetworkX on all ${e1pairs.toLocaleString("en-GB")} pairs in four networks.`],
    ["E2 Separate backups", `${nf(e2["Nigeria-20"]["fully separate %"], 2)}%`, `Nigeria-20: ${e2["Nigeria-20"]["fully separate backups"]} of ${e2["Nigeria-20"].pairs} pairs got a fully separate backup. BA-50: ${nf(e2["BA-50"]["fully separate %"], 0)}%.`],
    ["E3 One link cut", `${nf(e3["Nigeria-20"]["protected %"], 2)}%`, `of affected connections in Nigeria-20 switched at once, with no new calculation (${e3["Nigeria-20"].protected} of ${e3["Nigeria-20"].affected}). BA-50: ${nf(e3["BA-50"]["protected %"], 0)}%.`],
    ["E4 Three links cut", `${nf(e4("Nigeria-20", 3, "redundant")["mean %"], 2)}%`, `of Nigeria-20 connections still had a working stored path, against ${nf(e4("Nigeria-20", 3, "single")["mean %"], 2)}% with one path (2,000 trials).`],
    ["E5 Recovery work", `${nf(e5["Nigeria-20"].protection_median_ms, 4)} ms`, `median time to switch to the stored backup in Nigeria-20, against ${nf(e5["Nigeria-20"].restoration_median_ms, 3)} ms to re-run Dijkstra.`],
    ["E6 Packet loss", `${nf(k.e6_main_reduction_pct, 1)}% less`, `avoidable packet loss at a ${nf(sens[0]["restoration total (ms)"], 1)} ms restoration time, and ${nf(sens[sens.length - 1]["reduction %"], 1)}% less at ${nf(sens[sens.length - 1]["restoration total (ms)"], 1)} ms. Two-pass lost less in every one of the ${k.e6_settings.runs} runs.`],
  ];
  const e4rows = [1, 2, 3, 4, 5, 6].map((kk) => `<tr><td class="num">${kk}</td>
      <td class="num">${nf(e4("Nigeria-20", kk, "single")["mean %"], 2)}</td>
      <td class="num">${nf(e4("Nigeria-20", kk, "redundant")["mean %"], 2)}</td>
      <td class="num">${nf(e4("Nigeria-20", kk, "reachable")["mean %"], 2)}</td></tr>`).join("");
  const e6rows = sens.map((r) => `<tr><td class="num">${nf(r["restoration total (ms)"], 1)}</td>
      <td class="num">${nf(r["plain Dijkstra avoidable lost"], 1)}</td><td class="num">${nf(r["two-pass avoidable lost"], 1)}</td>
      <td class="num">${nf(r["reduction %"], 1)}%</td></tr>`).join("");
  const figs = [
    ["fig_multi_failure", "Several links cut together: connections still working, 2,000 trials for each number of cuts (E4)."],
    ["fig_recovery_time", "Computer time needed to recover: re-running Dijkstra against switching to the stored backup (E5)."],
    ["fig_simulation", "Packets lost to recovery delay in the 300-second simulations, 30 runs each (E6)."],
    ["fig_stretch", "How much longer the backup is than the primary, for every pair (E2)."],
  ];
  const v = k.versions;
  el.innerHTML = `
    <div><h2>Experiment results</h2><p class="muted">These numbers are read from <code>results/key_numbers.json</code>, written by the Jupyter notebook. Software: Python ${esc(v.python)}, NetworkX ${esc(v.networkx)}, NumPy ${esc(v.numpy)}, SciPy ${esc(v.scipy)}.</p></div>
    <div class="tiles">${tiles.map(([a, b, c]) => `<div class="tile"><div class="t-exp">${a}</div><div class="t-value">${b}</div><div class="t-text">${c}</div></div>`).join("")}</div>
    <div class="card" id="checkCard">
      <h3>Live check: does this website give the same answers as the notebook?</h3>
      <p>The button asks the server to rebuild both routing tables with <code>redundant_dijkstra.py</code> and compare them with the numbers the notebook saved.</p>
      <div class="btn-row"><button class="btn primary" id="runCheck">Run the live check</button></div>
      <div id="checkOut">${S.check ? checkHtml(S.check) : ""}</div>
    </div>
    <div class="figs">${figs.map(([f, c]) => `<figure><img src="/figures/screen/${f}.png" alt="${esc(c)}" loading="lazy"><figcaption>${esc(c)}</figcaption></figure>`).join("")}</div>
    <div class="figs">
      <div class="card table-wrap"><h3>E4: connections still working, Nigeria-20 (%)</h3>
        <table class="mini"><thead><tr><th class="num">Links cut</th><th class="num">One path</th><th class="num">Two-pass</th><th class="num">Reachable at all</th></tr></thead><tbody>${e4rows}</tbody></table>
        <p class="muted" style="margin-top:8px">"Reachable at all" is the most any method could achieve. Every difference was significant (Wilcoxon test, p &lt; 0.001).</p></div>
      <div class="card table-wrap"><h3>E6: avoidable packets lost per run</h3>
        <table class="mini"><thead><tr><th class="num">Restoration (ms)</th><th class="num">Plain Dijkstra</th><th class="num">Two-pass</th><th class="num">Reduction</th></tr></thead><tbody>${e6rows}</tbody></table>
        <p class="muted" style="margin-top:8px">Means of ${k.e6_settings.runs} runs of ${nf(k.e6_settings.duration_s, 0)} seconds, ${k.e6_settings.n_failures} cuts each, flows at ${k.e6_settings.rate_pps} packets per second. "Avoidable" leaves out loss that no method could prevent.</p></div>
    </div>`;
}
function checkHtml(c) {
  const rows = c.checks.map((x) => `<tr><td>${esc(x.what)}</td><td>${esc(Array.isArray(x.live) ? x.live.join(", ") : x.live)}</td><td class="${x.match ? "check-ok" : "check-bad"}">${x.match ? "✓ Match" : "✗ Differs"}</td></tr>`).join("");
  return `${c.all_match ? status("good", `<b>All ${c.checks.length} checks match the notebook.</b>`) : status("bad", "<b>Some checks differ from the notebook.</b>")}
    <div class="table-wrap" style="margin-top:12px"><table class="mini"><thead><tr><th>What was checked</th><th>Live value</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ------------------------------------------------------------ controller */
function fillSelects() {
  const ids = S.data.nodes.map((n) => n.id).sort(natural);
  $("#from").innerHTML = ids.map((id) => `<option${id === S.from ? " selected" : ""}>${esc(id)}</option>`).join("");
  $("#to").innerHTML = ids.filter((id) => id !== S.from).map((id) => `<option${id === S.to ? " selected" : ""}>${esc(id)}</option>`).join("");
}

function writeHash() {
  const q = new URLSearchParams({ net: S.net, from: S.from, to: S.to, tab: S.tab });
  history.replaceState(null, "", `#${q}`);
}

async function refresh() {
  showError(null);
  writeHash();
  const work = ["route", "cut", "trace"].includes(S.tab);
  $("#workspace").hidden = !work;
  $("#results").hidden = S.tab !== "results";
  $("#about").hidden = S.tab !== "about";
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === S.tab)));
  try {
    if (S.tab === "route") { S.route = await getRoute(); renderRoute(); S.redraw = renderRoute; }
    else if (S.tab === "cut") { S.cutRes = await getCut(); renderCut(); S.redraw = renderCut; }
    else if (S.tab === "trace") { S.trace = await getTrace(); renderTrace(); S.redraw = renderTrace; }
    else if (S.tab === "results") await renderResults();
  } catch (e) { showError(e); }
}

async function setNetwork(id, from, to) {
  stopPlay();
  S.net = id;
  S.data = await getNetwork(id);
  const ids = S.data.nodes.map((n) => n.id);
  S.from = ids.includes(from) ? from : S.data.default[0];
  S.to = ids.includes(to) && to !== S.from ? to : (S.data.default[1] !== S.from ? S.data.default[1] : ids.find((x) => x !== S.from));
  S.cuts = []; S.step = 1; S.nextPick = "from";
  $("#net").value = id;
  fillSelects();
}

function setPair(from, to) {
  stopPlay();
  S.from = from; S.to = to; S.cuts = []; S.step = 1;
  fillSelects();
  refresh();
}

function bind() {
  $("#net").addEventListener("change", async (e) => { try { await setNetwork(e.target.value); refresh(); } catch (err) { showError(err); } });
  $("#from").addEventListener("change", (e) => {
    const f = e.target.value;
    setPair(f, f === S.to ? S.data.nodes.map((n) => n.id).sort(natural).find((x) => x !== f) : S.to);
  });
  $("#to").addEventListener("change", (e) => setPair(S.from, e.target.value));
  $("#swap").addEventListener("click", () => setPair(S.to, S.from));
  $("#showCosts").addEventListener("change", (e) => { S.showCosts = e.target.checked; refresh(); });
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { stopPlay(); S.tab = t.dataset.tab; refresh(); }));

  const map = $("#map");
  const nodeAct = (id) => {
    if (S.tab === "trace") { setPair(id, id === S.to ? S.from : S.to); return; }
    if (S.nextPick === "from") {
      S.nextPick = "to";
      setPair(id, id === S.to ? S.from : S.to);
    } else {
      S.nextPick = "from";
      if (id !== S.from) setPair(S.from, id); else refresh();
    }
  };
  map.addEventListener("click", (e) => {
    const lk = e.target.closest("[data-link]");
    if (lk && S.tab === "cut") {
      const k = lk.dataset.link;
      S.cuts = S.cuts.includes(k) ? S.cuts.filter((x) => x !== k) : [...S.cuts, k];
      refresh(); return;
    }
    const nd = e.target.closest("[data-node]");
    if (nd) nodeAct(nd.dataset.node);
  });
  map.addEventListener("keydown", (e) => {
    const nd = e.target.closest("[data-node]");
    if (nd && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); nodeAct(nd.dataset.node); }
  });

  $("#panel").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.pair) { const [s, t] = b.dataset.pair.split("|"); setPair(s, t); }
    else if (b.dataset.uncut) { S.cuts = S.cuts.filter((x) => x !== b.dataset.uncut); refresh(); }
    else if (b.dataset.install) { S.installMs = Number(b.dataset.install); renderCut(); }
    else if (b.dataset.step) stepCmd(b.dataset.step);
    else if (b.id === "cutClear") { S.cuts = []; refresh(); }
    else if (b.id === "cutPrimary") {
      // cut the next primary link that is not cut yet; if the primary is
      // already broken, cut the next link of whatever path is now in use
      const res = S.cutRes;
      const inUse = res && res.two_pass.path ? res.two_pass.path : (res ? res.primary : null);
      const src = res && res.primary_ok ? res.primary : inUse;
      if (!src) return;
      const next = pairKey(src).find((k) => !S.cuts.includes(k));
      if (next) { S.cuts = [...S.cuts, next]; refresh(); }
    }
  });
  let lastW = 0, rt = null;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const w = $("#map").clientWidth;
      if (w && w !== lastW && S.redraw && !$("#workspace").hidden) { lastW = w; S.redraw(); }
    }, 150);
  });

  $("#results").addEventListener("click", async (e) => {
    if (e.target.id !== "runCheck") return;
    e.target.disabled = true; e.target.textContent = "Checking…";
    try { S.check = await api("/api/check"); $("#checkOut").innerHTML = checkHtml(S.check); }
    catch (err) { showError(err); }
    e.target.disabled = false; e.target.textContent = "Run the live check again";
  });
}

// The address bar keeps the view (network, pair, tab), so a link opens the same view.
async function applyHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const net = S.nets.some((n) => n.id === h.get("net")) ? h.get("net") : "nigeria";
  S.tab = ["route", "cut", "trace", "results", "about"].includes(h.get("tab")) ? h.get("tab") : "route";
  await setNetwork(net, h.get("from"), h.get("to"));
  refresh();
}

async function init() {
  bind();
  try {
    S.nets = await api("/api/networks");
    $("#net").innerHTML = S.nets.map((n) => `<option value="${n.id}">${esc(n.label)}</option>`).join("");
    await applyHash();
    window.addEventListener("hashchange", () => applyHash().catch(showError));
  } catch (e) {
    showError(e);
  }
}
init();
