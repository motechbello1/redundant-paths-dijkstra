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
let viewRequest = 0, networkRequest = 0;
const NETWORK_COPY = {
  nigeria: ['Nigeria · 20 cities', 'A hypothetical national network. Distances are in kilometres.'],
  abuja: ['Abuja · 6 districts', 'A small example to learn with. Lower cost means a cheaper route.'],
  ba50: ['Research · 50 nodes', 'A larger, generated network. Numbers are node names, not distances.'],
};
function announce(message) { $('#activity').textContent = message; }
function setControlsBusy(busy) {
  ['net', 'from', 'to', 'swap', 'shareRoute', 'startExample'].forEach(id => { $('#' + id).disabled = busy; });
}
function themeLabel() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#themeToggle').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
  $('#themeToggle').setAttribute('aria-pressed', String(dark));
  document.querySelector('meta[name="theme-color"]').content = dark ? '#151517' : '#f7f7f5';
}
function focusInPanel() {
  const el = document.activeElement;
  if (!el || !$('#panel').contains(el)) return null;
  if (el.id) return '#' + el.id;
  if (el.dataset.step) return `[data-step="${el.dataset.step}"]`;
  if (el.dataset.install) return `[data-install="${el.dataset.install}"]`;
  return null;
}
function restorePanelFocus(selector) {
  if (selector) $(selector, $('#panel'))?.focus({ preventScroll: true });
}


/* ------------------------------------------------------------------ API */
async function api(path, opts) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let res;
  try { res = await fetch(path, { ...opts, signal: controller.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'The server took too long to respond' : 'We could not reach the server. Check your connection'); }
  finally { clearTimeout(timeout); }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch (e) { /* not JSON */ }
    throw new Error(msg);
  }
  return res.json();
}
function showError(e) {
  const box = $("#error");
  $("#errorMessage").textContent = e ? `Something went wrong: ${e.message || e}. Please try again.` : "";
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
  const W = Math.max(260, Math.round($("#map").clientWidth || 800));
  const narrow = W < 560;
  const PAD = narrow ? 48 : 66;
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
  const parts = [`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="${esc(d.label)}. Select a node to change the route." class="${narrow ? "narrow" : ""} ${big ? "small-labels" : ""}">`];

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
    parts.push(`<g class="${cls}" data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(n.id)}${n.id === S.from ? ", starting point" : n.id === S.to ? ", destination" : ""}"><circle class="node-hit" cx="${x}" cy="${y}" r="18"/>`,
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
    primary: `<svg width="28" height="8"><line x1="2" y1="4" x2="26" y2="4" stroke="var(--primary)" stroke-width="5" stroke-linecap="round"/></svg>`,
    backup: `<svg width="28" height="8"><line x1="2" y1="4" x2="26" y2="4" stroke="var(--backup)" stroke-width="4" stroke-dasharray="7 5" stroke-linecap="round"/></svg>`,
    rerun: `<svg width="28" height="8"><line x1="2" y1="4" x2="26" y2="4" stroke="var(--rerun)" stroke-width="5" stroke-linecap="round"/></svg>`,
    faint: `<svg width="28" height="8"><line x1="2" y1="4" x2="26" y2="4" stroke="var(--primary)" stroke-opacity=".22" stroke-width="3"/></svg>`,
    cut: `<svg width="22" height="22"><circle cx="11" cy="11" r="9" fill="var(--card)" stroke="var(--cut)" stroke-width="2"/><path d="M7 7l8 8M15 7l-8 8" stroke="var(--cut)" stroke-width="2.4" stroke-linecap="round"/></svg>`,
    shared: `<svg width="28" height="12"><line x1="3" y1="6" x2="25" y2="6" stroke="var(--cut)" stroke-opacity=".25" stroke-width="10" stroke-linecap="round"/></svg>`,
    tree: `<svg width="28" height="8"><line x1="2" y1="4" x2="26" y2="4" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/></svg>`,
    settled: `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="var(--ink)" stroke="var(--ink)" stroke-width="2"/></svg>`,
    current: `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="var(--backup)" stroke="var(--ink)" stroke-width="2"/></svg>`,
    frontier: `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="var(--warn-bg)" stroke="var(--warn)" stroke-width="2"/></svg>`,
    unreached: `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="var(--card)" stroke="var(--ink)" stroke-width="2"/></svg>`,
    two: `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="var(--card)" stroke="var(--ink)" stroke-width="2" stroke-dasharray="3 2"/></svg>`,
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
  const r = S.route, d = S.data, summary = d.summary;
  $('#mapTitle').textContent = `${S.from} to ${S.to}`;
  $('#mapHint').textContent = `Tap a point to set your ${S.nextPick === 'from' ? 'start' : 'destination'}.`;
  renderMap({
    overlays: [{ path: r.backup, cls: 'p-backup' }, { path: r.primary, cls: 'p-primary' }],
    shared: r.shared,
    nodeClass: id => id === S.from || id === S.to ? 'end' : '',
  });
  const items = [['primary', 'Main route'], ['backup', 'Backup route']];
  if (r.shared.length) items.push(['shared', 'Shared link']);
  legend(items);
  const pct = Math.round(100 * (r.backup_cost / r.primary_cost - 1));
  const sharedTxt = r.shared.map(l => l.join(' to ')).join(', ');
  const routeCard = (backup) => `<div class="route-card">
    <div class="route-card-head"><span><span class="swatch ${backup ? 'backup' : ''}"></span><b>${backup ? 'Backup route' : 'Main route'}</b></span><span>${backup ? 'Plan B' : 'Lowest cost'}</span></div>
    <div class="route-card-body"><div class="route-cost">${nf(backup ? r.backup_cost : r.primary_cost, dec())}<small>${esc(unit())}</small></div>
    <div class="route-description">${backup ? r.backup_hops : r.primary_hops} links${backup ? ` · ${pct}% ${unit() === 'km' ? 'longer' : 'more cost'}` : ' · First choice'}</div>
    ${pathHtml(backup ? r.backup : r.primary)}</div></div>`;
  $('#panel').innerHTML = `<div class="card route-result">
    <p class="section-label">YOUR ROUTES, AT A GLANCE</p><h2>A way there. A spare ready.</h2>
    <div class="route-cards">${routeCard(false)}${routeCard(true)}</div>
    ${r.disjoint ? status('good', '<b>Your backup uses separate links.</b><br>If one main-route link breaks, the backup can take over.')
      : status('warn', `<b>These routes share ${r.shared.length} ${r.shared.length === 1 ? 'link' : 'links'}.</b><br>${esc(sharedTxt)}. A break here affects both routes.`)}
    <button class="btn primary next-action" data-goto="cut">Test a broken link <span aria-hidden="true">→</span></button>
    <details class="detail-fold" id="calculationDetails"><summary>How were these routes found?</summary><p>Dijkstra first found the cheapest route. We then added ${nf(r.penalty, dec())} ${esc(unit())} to each of its links and ran Dijkstra again to find a backup.</p><p class="muted">Both passes took ${nf(r.two_pass_ms, 3)} ms on the server. The route costs above show the original costs, without the added penalty.</p></details>
    </div>
    <details class="card routing-detail" id="networkDetails"><summary>Explore this network’s numbers</summary>
      <table class="mini"><tbody>
      <tr><td>Places / links</td><td class="num">${summary.nodes} / ${summary.links}</td></tr>
      <tr><td>Pairs of places</td><td class="num">${nf(summary.pairs, 0)}</td></tr>
      <tr><td>Pairs with a separate backup</td><td class="num">${summary.fully_separate} (${nf(summary.fully_separate_pct, 2)}%)</td></tr>
      <tr><td>Typical backup / main cost</td><td class="num">${nf(summary.median_stretch, 3)}×</td></tr>
      <tr><td>Switch rules, main only / with backups</td><td class="num">${nf(summary.rules_primary, 0)} / ${nf(summary.rules_both, 0)}</td></tr>
      <tr><td>Time to build all routes</td><td class="num">${nf(summary.table_build_ms)} ms</td></tr>
      </tbody></table>
      ${summary.not_separate.length ? `<p style="margin-top:14px">Try a pair whose routes share a link:</p>${summary.not_separate.map(pair => `<button class="chip-btn" data-pair="${esc(pair.source)}|${esc(pair.target)}">${esc(pair.source)} → ${esc(pair.target)}</button>`).join('')}<p class="muted">A separate pair may exist even when this two-pass method does not find it.</p>` : '<p style="margin-top:12px">Every pair has a separate backup.</p>'}
      ${summary.two_link_nodes.length ? `<p class="muted" style="margin-top:12px">Places with only two links: ${esc(summary.two_link_nodes.join(', '))}. If both break, the place becomes unreachable.</p>` : ''}
    </details>`;
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
  $("#mapTitle").textContent = `${S.from} to ${S.to}`;
  $("#mapHint").textContent = "Tap a line to break it. Tap again to repair.";
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
      <p class="section-label">TRY A FAILURE</p><h2>Does your backup hold?</h2><p>Break a main-route link and compare how each method recovers.</p>
      <div class="btn-row">
        <button class="btn primary" id="cutPrimary">Break next route link</button>
        <button class="btn" id="cutClear" ${S.cuts.length ? "" : "disabled"}>Repair all</button>
      </div>
      <div>${chips}</div>
      <details class="cut-select"><summary>Choose a specific link</summary><label class="field"><span>Link to break or repair</span><select id="linkChoice">${S.data.links.map(l => { const key = linkKey(l.u, l.v); return `<option value="${esc(key)}">${esc(l.u)} ↔ ${esc(l.v)}${cuts.has(key) ? ' (broken)' : ''}</option>`; }).join('')}</select></label><button class="btn" id="toggleLink">Break / repair selected link</button></details>
      <details class="detail-fold" id="timingDetails"><summary>Recovery timing settings</summary><p class="muted">Choose the simulated detection and installation delay. Measured calculation time is added to this.</p>
      <div class="seg" role="group" aria-label="Restoration time setting">
        ${INSTALL_CHOICES.map(([v, l]) => `<button type="button" data-install="${v}" aria-pressed="${S.installMs === v}">${l}</button>`).join("")}
      </div>
      </details><p class="cut-note muted">A simulation, not a live network outage.</p>
    </div>
    ${res ? methodCard("Plain Dijkstra (one path)", res.plain, res, false) + methodCard("Two-pass Dijkstra (primary + backup)", res.two_pass, res, true) : `<div class="card loading">Working…</div>`}
    ${summary ? `<div class="card">${summary}</div>` : ""}`;
}

/* ------------------------------------------------------------ trace tab */
function renderTrace() {
  const focused = focusInPanel();
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
  restorePanelFocus(focused);
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
    <div><h2>Experiment results</h2><p class="muted">Six experiments, using the same routing method as this planner. These are saved study results. Use the live check below to verify the routing numbers again.</p></div>
    <div class="tiles">${tiles.map(([a, b, c]) => `<div class="tile"><div class="t-exp">${a}</div><div class="t-value">${b}</div><div class="t-text">${c}</div></div>`).join("")}</div>
    <div class="card" id="checkCard">
      <h3>Live check: does this website give the same answers as the notebook?</h3>
      <p>Recalculate the routes and check whether they match the saved study. This may take a few seconds.</p>
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
  const request = ++viewRequest;
  const tab = S.tab;
  const focused = focusInPanel();
  const openDetails = [...document.querySelectorAll('#panel details[open][id]')].map(el => el.id);
  showError(null);
  writeHash();
  const work = ['route', 'cut', 'trace'].includes(tab);
  $('#studio').hidden = !work;
  $('#workspace').hidden = !work;
  $('#results').hidden = tab !== 'results';
  $('#about').hidden = tab !== 'about';
  $('#workspace').setAttribute('aria-labelledby', `tab-${tab}`);
  document.querySelectorAll('.tab').forEach(t => {
    t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    t.tabIndex = t.dataset.tab === tab ? 0 : -1;
  });
  $('#workspace').setAttribute('aria-busy', String(work));
  $('#workspace').inert = work;
  S.redraw = null;
  setControlsBusy(true);
  announce(work ? 'Updating your view.' : '');
  try {
    if (tab === 'route') {
      const result = await getRoute(); if (request !== viewRequest) return;
      S.route = result; renderRoute(); S.redraw = renderRoute;
    } else if (tab === 'cut') {
      const result = await getCut(); if (request !== viewRequest) return;
      S.cutRes = result; renderCut(); S.redraw = renderCut;
    } else if (tab === 'trace') {
      const result = await getTrace(); if (request !== viewRequest) return;
      S.trace = result; renderTrace(); S.redraw = renderTrace;
    } else if (tab === 'results') await renderResults();
    if (request !== viewRequest) return;
    openDetails.forEach(id => { const el = document.getElementById(id); if (el) el.open = true; });
    announce(work ? `${S.from} to ${S.to}. ${tab === 'route' ? 'Main and backup routes ready.' : 'View ready.'}` : `${tab === 'results' ? 'Study results' : 'How it works'} ready.`);
  } catch (e) { if (request === viewRequest) showError(e); }
  finally {
    if (request === viewRequest) {
      $('#workspace').setAttribute('aria-busy', 'false');
      $('#workspace').inert = false;
      setControlsBusy(!S.data);
      restorePanelFocus(focused);
    }
  }
}

async function setNetwork(id, from, to) {
  const request = ++networkRequest;
  ++viewRequest;
  stopPlay();
  setControlsBusy(true);
  $('#workspace').setAttribute('aria-busy', 'true');
  $('#workspace').inert = true;
  S.redraw = null;
  try {
    const data = await getNetwork(id);
    if (request !== networkRequest) return false;
    S.net = id; S.data = data;
    const ids = S.data.nodes.map(n => n.id);
    S.from = ids.includes(from) ? from : S.data.default[0];
    S.to = ids.includes(to) && to !== S.from ? to : (S.data.default[1] !== S.from ? S.data.default[1] : ids.find(x => x !== S.from));
    S.cuts = []; S.step = 1; S.nextPick = 'from';
    $('#net').value = id;
    $('#networkNote').textContent = NETWORK_COPY[id][1];
    $('#mapNetwork').textContent = NETWORK_COPY[id][0].toUpperCase();
    $('#mapDisclaimer').textContent = id === 'nigeria' ? 'Hypothetical network. Not a live telecom map.' : id === 'abuja' ? 'Teaching example. Link costs are illustrative.' : 'Synthetic network. Node positions are for illustration.';
    $('#networkStats').innerHTML = `<div><strong>${data.summary.nodes}</strong><span>${id === 'ba50' ? 'Network nodes' : id === 'abuja' ? 'Abuja districts' : 'Nigerian cities'}</span></div><div><strong>${data.summary.links}</strong><span>Connecting links</span></div><div><strong>${nf(data.summary.fully_separate_pct, data.summary.fully_separate_pct === 100 ? 0 : 1)}<small>%</small></strong><span>Pairs with separate backups</span></div>`;
    fillSelects();
    return true;
  } catch (e) {
    if (request === networkRequest) {
      $('#net').value = S.net;
      $('#workspace').setAttribute('aria-busy', 'false');
      $('#workspace').inert = false;
      setControlsBusy(!S.data);
    }
    throw e;
  }
}

function setPair(from, to) {
  stopPlay();
  S.from = from; S.to = to; S.cuts = []; S.step = 1;
  fillSelects();
  refresh();
}

function bind() {
  $("#net").addEventListener("change", async (e) => { try { if (await setNetwork(e.target.value)) await refresh(); } catch (err) { showError(err); } });
  $("#from").addEventListener("change", (e) => {
    const f = e.target.value;
    setPair(f, f === S.to ? S.data.nodes.map((n) => n.id).sort(natural).find((x) => x !== f) : S.to);
  });
  $("#to").addEventListener("change", (e) => setPair(S.from, e.target.value));
  $("#swap").addEventListener("click", () => setPair(S.to, S.from));
  $("#showCosts").addEventListener("change", (e) => { S.showCosts = e.target.checked; if (S.redraw) S.redraw(); });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => goTab(t.dataset.tab)));
  $('.tabs').addEventListener('keydown', e => {
    const tabs = [...document.querySelectorAll('.tab')];
    const index = tabs.indexOf(e.target);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); goTab(tabs[next].dataset.tab);
  });
  document.addEventListener('click', e => { const trigger = e.target.closest('[data-goto]'); if (trigger) goTab(trigger.dataset.goto, true); });
  $('#themeToggle').addEventListener('click', () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('path-planner-theme', document.documentElement.dataset.theme); } catch (e) { /* private browser mode */ }
    themeLabel();
  });
  themeLabel();
  $('#startExample').addEventListener('click', async () => {
    try { S.tab = 'route'; if (await setNetwork('abuja')) await refresh(); $('#planner').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    catch (e) { showError(e); }
  });
  $('#retry').addEventListener('click', async () => {
    try { if (!S.data) await loadInitial(); else await refresh(); } catch (e) { showError(e); }
  });
  $('#shareRoute').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); $('#shareRoute').textContent = 'Link copied ✓'; announce('Link copied to clipboard.'); setTimeout(() => { $('#shareRoute').innerHTML = 'Copy link to this view <span aria-hidden="true">↗</span>'; }, 2200); }
    catch (e) { $('#shareUrl').value = location.href; $('#shareDialog').showModal(); $('#shareUrl').select(); }
  });
  $('#expandMap').addEventListener('click', () => toggleMap());
  document.addEventListener('keydown', e => {
    if (!$('#mapCard').classList.contains('expanded')) return;
    if (e.key === 'Escape') { e.preventDefault(); toggleMap(false); }
    if (e.key === 'Tab') {
      const els = [...$('#mapCard').querySelectorAll('button, input, [tabindex="0"]')];
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  $('#backTop').addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); $('.brand').focus({ preventScroll: true }); });
  window.addEventListener('scroll', () => { $('#backTop').hidden = window.scrollY < 500; }, { passive: true });

  const map = $("#map");
  const nodeAct = (id) => {
    if (S.tab === "cut") return;
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
    if (b.id === 'toggleLink') { const key = $('#linkChoice').value; S.cuts = S.cuts.includes(key) ? S.cuts.filter(k => k !== key) : [...S.cuts, key]; refresh(); }
    else if (b.dataset.pair) { const [s, t] = b.dataset.pair.split("|"); setPair(s, t); }
    else if (b.dataset.uncut) { S.cuts = S.cuts.filter((x) => x !== b.dataset.uncut); refresh(); }
    else if (b.dataset.install) { const focused = focusInPanel(); S.installMs = Number(b.dataset.install); renderCut(); $("#timingDetails").open = true; restorePanelFocus(focused); }
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
      if (w && w !== lastW && S.redraw && !$("#workspace").hidden) { lastW = w; const open = [...document.querySelectorAll('#panel details[open][id]')].map(el => el.id); S.redraw(); open.forEach(id => { const el = document.getElementById(id); if (el) el.open = true; }); }
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
  if (await setNetwork(net, h.get("from"), h.get("to"))) await refresh();
}

async function goTab(tab, scroll = false) {
  stopPlay();
  if ($('#mapCard').classList.contains('expanded')) toggleMap(false);
  S.tab = tab;
  if (S.data) await refresh();
  if (scroll) { $(`#tab-${tab}`).focus({ preventScroll: true }); $('.tabs-bar').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
function toggleMap(force) {
  const card = $('#mapCard');
  const expanded = typeof force === 'boolean' ? force : !card.classList.contains('expanded');
  card.classList.toggle('expanded', expanded);
  if (expanded) { card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', 'Expanded network map'); }
  else { card.removeAttribute('role'); card.removeAttribute('aria-modal'); card.removeAttribute('aria-label'); }
  document.body.style.overflow = expanded ? 'hidden' : '';
  ['.site-header', '.intro', '.tabs-bar', '#planner', '#panel', '#networkStats', '.site-footer'].forEach(sel => { $(sel).inert = expanded; });
  $('#expandMap').setAttribute('aria-label', expanded ? 'Close expanded map' : 'Expand network map');
  if (S.redraw) S.redraw();
  $('#expandMap').focus({ preventScroll: true });
}
async function loadInitial() {
  showError(null);
  setControlsBusy(true);
  S.nets = await api('/api/networks');
  $('#net').innerHTML = S.nets.map(n => `<option value="${n.id}">${esc(NETWORK_COPY[n.id]?.[0] || n.label)}</option>`).join('');
  await applyHash();
}
async function init() {
  bind();
  window.addEventListener('hashchange', () => applyHash().catch(showError));
  try { await loadInitial(); }
  catch (e) { showError(e); $('#map').innerHTML = '<div class="loading">Your network could not load.<br>Use “Try again” above to reconnect.</div>'; $('#panel').innerHTML = ''; }
}
init();
