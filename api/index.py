"""
Redundant Path Planner API (runs on Vercel as a Python serverless function).

MSc Computer Science project, Maryam Sirajo (BU/23C/PGS/9469), Baze University, Abuja.
"Optimizing Redundant Paths Using Dijkstra's Algorithm for Enhancing Network Reliability"

Every route this API returns comes from redundant_dijkstra.py, the SAME file the
Jupyter notebook and the Streamlit app use. Nothing here re-implements routing:
this file only loads the networks, calls the module and turns the answers into JSON.

Endpoints (all GET except /api/cut):
  /api/health                     versions and a quick self-test
  /api/networks                   the three networks you can pick
  /api/network/{net}              nodes, links and a summary of the routing table
  /api/route?net=&source=&target= primary and backup path for one pair
  /api/cut   (POST JSON)          what each method does when links are cut
  /api/trace?net=&source=         Dijkstra step by step, for teaching
  /api/check                      re-computes the notebook's headline numbers live
"""
import json
import math
import os
import platform
import statistics
import sys
import time
from functools import lru_cache
from typing import List, Optional

# The routing module sits in the project root, one folder above this file.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import networkx as nx                      # noqa: E402
import numpy as np                         # noqa: E402
from fastapi import FastAPI, HTTPException, Query   # noqa: E402
from pydantic import BaseModel             # noqa: E402

import redundant_dijkstra as rd            # noqa: E402

app = FastAPI(
    title="Redundant Path Planner API",
    description="Two-pass Dijkstra: a primary path and a link-separate backup path. "
                "Only Dijkstra's algorithm is used for routing.",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# Restoration model from experiment E6 (dissertation Section 3.8):
# failure detection 50 ms (BFD), rule installation 50 ms in the main setting.
DETECT_MS = 50.0
INSTALL_MS_MAIN = 50.0


# ----------------------------------------------------------------------------
# Networks
# ----------------------------------------------------------------------------
def abuja_districts():
    """The six-district teaching example (same as the notebook and app.py)."""
    g = nx.Graph(name="Six Abuja districts (teaching example)")
    for a, b, w in [("Garki", "Wuse", 4), ("Garki", "Asokoro", 2), ("Asokoro", "Wuse", 1),
                    ("Wuse", "Jabi", 5), ("Asokoro", "Maitama", 7), ("Wuse", "Maitama", 3),
                    ("Jabi", "Gwarinpa", 3), ("Maitama", "Gwarinpa", 6)]:
        g.add_edge(a, b, weight=w)
    pos = {"Garki": (0, 0), "Asokoro": (1, -1), "Wuse": (1, 1), "Maitama": (2.2, 0.3),
           "Jabi": (2.2, 1.6), "Gwarinpa": (3.4, 1.0)}
    nx.set_node_attributes(g, pos, "pos")
    return g


NETWORKS = {
    "nigeria": {"label": "Hypothetical Nigerian backbone (20 cities)", "short": "Nigeria-20",
                "unit": "km", "default": ["Lagos", "Maiduguri"]},
    "ba50": {"label": "Synthetic scale-free network (50 nodes)", "short": "BA-50",
             "unit": "cost units", "default": ["0", "49"]},
    "abuja": {"label": "Six Abuja districts (teaching example)", "short": "Abuja-6",
              "unit": "cost units", "default": ["Garki", "Gwarinpa"]},
}


def _normalise(points, flip_y=True):
    """Scale positions into a box whose longer side is 1, keeping the shape."""
    xs = [p[0] for p in points.values()]
    ys = [p[1] for p in points.values()]
    span = max(max(xs) - min(xs), max(ys) - min(ys)) or 1.0
    out = {}
    for n, (x, y) in points.items():
        nx_ = (x - min(xs)) / span
        ny_ = (y - min(ys)) / span
        out[n] = (round(nx_, 4), round((max(ys) - min(ys)) / span - ny_ if flip_y else ny_, 4))
    return out


@lru_cache(maxsize=None)
def load(net):
    """Build a network and its full routing table once, then keep it in memory."""
    if net not in NETWORKS:
        raise HTTPException(404, f"Unknown network '{net}'. Use one of {list(NETWORKS)}.")
    if net == "nigeria":
        g = rd.nigeria_backbone()
        # pos = (longitude, latitude); squeeze longitude so the map is not stretched
        raw = {n: (lon * math.cos(math.radians(9.0)), lat)
               for n, (lon, lat) in nx.get_node_attributes(g, "pos").items()}
    elif net == "ba50":
        g = rd.scale_free_network(50, m=2, seed=42)
        raw = {n: tuple(map(float, p)) for n, p in nx.spring_layout(g, seed=7).items()}
    else:
        g = abuja_districts()
        raw = nx.get_node_attributes(g, "pos")
    t0 = time.perf_counter()
    table = rd.build_routing_table(g)
    build_ms = (time.perf_counter() - t0) * 1000.0
    names = {str(n): n for n in g.nodes}          # BA-50 nodes are numbers
    return g, table, names, _normalise(raw), build_ms


def node_of(names, label):
    if label not in names:
        raise HTTPException(400, f"Unknown node '{label}'.")
    return names[label]


def lookup(table, s, t):
    """The table stores each pair once; flip the paths if asked the other way."""
    if (s, t) in table:
        return table[(s, t)]
    r = dict(table[(t, s)])
    r["primary"], r["backup"] = r["primary"][::-1], r["backup"][::-1]
    return r


def link_list(links):
    return [sorted(map(str, l)) for l in sorted(links, key=lambda l: sorted(map(str, l)))]


def median_ms(fn, repeat=5):
    return rd.median_ms(fn, repeat)


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------
@app.get("/api/health")
def health():
    g, table, _, _, _ = load("nigeria")
    r = table[("Lagos", "Maiduguri")]
    return {
        "status": "ok",
        "routing_module": "redundant_dijkstra.py (same file as the notebook)",
        "python": platform.python_version(),
        "networkx": nx.__version__,
        "numpy": np.__version__,
        "self_test": {"pair": "Lagos to Maiduguri",
                      "primary_km": round(r["primary_cost"], 1),
                      "backup_km": round(r["backup_cost"], 1)},
    }


@app.get("/api/networks")
def networks():
    out = []
    for key, meta in NETWORKS.items():
        g, table, *_ = load(key)
        out.append({"id": key, **meta, "nodes": g.number_of_nodes(),
                    "links": g.number_of_edges(), "pairs": len(table)})
    return out


@app.get("/api/network/{net}")
def network(net: str):
    g, table, names, pos, build_ms = load(net)
    rows = list(table.values())
    stretch = [r["backup_cost"] / r["primary_cost"] for r in rows]
    not_separate = []
    for (s, t), r in table.items():
        if not r["disjoint"]:
            # Checking tool only (not routing): does ANY fully separate pair exist?
            exists = len(list(nx.edge_disjoint_paths(g, s, t))) >= 2
            not_separate.append({"source": str(s), "target": str(t),
                                 "shared": link_list(r["shared_links"]),
                                 "separate_pair_exists": exists})
    degree = dict(g.degree())
    return {
        "id": net, **NETWORKS[net],
        "nodes": [{"id": str(n), "x": pos[n][0], "y": pos[n][1], "degree": degree[n]}
                  for n in sorted(g.nodes, key=str)],
        "links": [{"u": str(u), "v": str(v), "weight": d["weight"]}
                  for u, v, d in sorted(g.edges(data=True), key=lambda e: (str(e[0]), str(e[1])))],
        "summary": {
            "nodes": g.number_of_nodes(),
            "links": g.number_of_edges(),
            "pairs": len(table),
            "fully_separate": sum(r["disjoint"] for r in rows),
            "fully_separate_pct": round(100 * sum(r["disjoint"] for r in rows) / len(rows), 2),
            "median_stretch": round(statistics.median(stretch), 3),
            "not_separate": not_separate,
            "two_link_nodes": sorted(str(n) for n, d in degree.items() if d == 2),
            "bridges": [sorted(map(str, e)) for e in nx.bridges(g)],
            "rules_primary": rd.forwarding_entries(table, redundant=False),
            "rules_both": rd.forwarding_entries(table, redundant=True),
            "penalty": round(g.size(weight="weight") + 1.0, 1),
            "table_build_ms": round(build_ms, 1),
        },
    }


@app.get("/api/route")
def route(net: str = Query("nigeria"), source: str = Query(...), target: str = Query(...)):
    g, table, names, _, _ = load(net)
    s, t = node_of(names, source), node_of(names, target)
    if s == t:
        raise HTTPException(400, "Pick two different nodes.")
    r = lookup(table, s, t)
    # Time a fresh two-pass run for this pair (two Dijkstra runs) on the server.
    ms = median_ms(lambda: rd.two_pass_redundant_paths(g, s, t))
    return {
        "source": source, "target": target,
        "primary": [str(n) for n in r["primary"]],
        "backup": [str(n) for n in r["backup"]],
        "primary_cost": round(r["primary_cost"], 1),
        "backup_cost": round(r["backup_cost"], 1),
        "stretch": round(r["backup_cost"] / r["primary_cost"], 3),
        "primary_hops": len(r["primary"]) - 1,
        "backup_hops": len(r["backup"]) - 1,
        "disjoint": r["disjoint"],
        "shared": link_list(r["shared_links"]),
        "penalty": round(g.size(weight="weight") + 1.0, 1),
        "two_pass_ms": round(ms, 4),
    }


class CutRequest(BaseModel):
    net: str = "nigeria"
    source: str
    target: str
    cut: List[List[str]] = []


@app.post("/api/cut")
def cut(req: CutRequest):
    g, table, names, _, _ = load(req.net)
    s, t = node_of(names, req.source), node_of(names, req.target)
    if s == t:
        raise HTTPException(400, "Pick two different nodes.")
    failed = set()
    for pair in req.cut:
        if len(pair) != 2:
            raise HTTPException(400, "Each cut link needs two node names.")
        a, b = node_of(names, pair[0]), node_of(names, pair[1])
        if not g.has_edge(a, b):
            raise HTTPException(400, f"There is no link {pair[0]} - {pair[1]}.")
        failed.add(frozenset((a, b)))
    r = lookup(table, s, t)
    primary_ok = not (rd.path_links(r["primary"]) & failed)
    backup_ok = not (rd.path_links(r["backup"]) & failed)

    # What plain Dijkstra must do: run Dijkstra again, skipping the cut links.
    working = lambda a, b, d: None if frozenset((a, b)) in failed else d["weight"]
    new_path, new_cost = rd.shortest_path(g, s, t, weight_fn=working)
    rerun_ms = median_ms(lambda: rd.shortest_path(g, s, t, weight_fn=working))
    reachable = new_path is not None

    def path_json(p):
        return [str(n) for n in p] if p else None

    if primary_ok:
        plain = {"status": "ok", "path": path_json(r["primary"]), "cost": r["primary_cost"]}
        two = {"status": "ok", "path": path_json(r["primary"]), "cost": r["primary_cost"]}
    else:
        plain = ({"status": "rerun", "path": path_json(new_path), "cost": new_cost}
                 if reachable else {"status": "down", "path": None, "cost": None})
        if backup_ok:
            two = {"status": "switch", "path": path_json(r["backup"]), "cost": r["backup_cost"]}
        elif reachable:
            two = {"status": "rerun", "path": path_json(new_path), "cost": new_cost}
        else:
            two = {"status": "down", "path": None, "cost": None}
    for m in (plain, two):
        if m["cost"] is not None:
            m["cost"] = round(m["cost"], 1)
    return {
        "primary": path_json(r["primary"]), "backup": path_json(r["backup"]),
        "primary_ok": primary_ok, "backup_ok": backup_ok, "reachable": reachable,
        "rerun_path": path_json(new_path),
        "rerun_cost": round(new_cost, 1) if reachable else None,
        "rerun_ms": round(rerun_ms, 4),
        "plain": plain, "two_pass": two,
        "timing_model": {"detect_ms": DETECT_MS, "install_ms_main": INSTALL_MS_MAIN},
    }


@app.get("/api/trace")
def trace(net: str = Query("nigeria"), source: str = Query(...)):
    g, _, names, _, _ = load(net)
    s = node_of(names, source)
    steps = rd.dijkstra_trace(g, s)
    settled_at = {}
    out = []
    for st in steps:
        u = st["settled"]
        d = st["dist"]
        # The node u was reached from: the EARLIEST settled neighbour v with
        # dist[v] + w(v, u) == dist[u]. Dijkstra only replaces a cost when it
        # finds a strictly cheaper one, so the first neighbour to reach the
        # final cost is the one it kept.
        parent = None
        if u != s:
            cands = [(settled_at[v], v) for v in g[u] if v in settled_at
                     and out[settled_at[v] - 1]["cost"] + g[u][v]["weight"] == d[u]]
            parent = str(min(cands)[1]) if cands else None
        settled_at[u] = st["step"]
        out.append({"step": st["step"], "settled": str(u), "cost": d[u], "parent": parent,
                    "dist": {str(n): (None if c == math.inf else round(c, 1)) for n, c in d.items()}})
    for row in out:
        row["cost"] = round(row["cost"], 1)
    return {"source": source, "steps": out}


@app.get("/api/check")
def check():
    """Re-compute the notebook's headline numbers on this server and compare
    them with results/key_numbers.json, which the notebook saved."""
    path = os.path.join(ROOT, "results", "key_numbers.json")
    with open(path) as f:
        k = json.load(f)
    rows = []

    def add(what, live, saved):
        rows.append({"what": what, "live": live, "notebook": saved, "match": live == saved})

    for net, label, rules_label in [("nigeria", "Nigeria-20", "Nigeria-20"),
                                    ("ba50", "BA-50 (seed 42)", "BA-50")]:
        g, table, *_ = load(net)
        vals = list(table.values())
        e2 = next(x for x in k["e2"] if x["network"] == label)
        rl = next(x for x in k["rules"] if x["network"] == rules_label)
        stretch = [r["backup_cost"] / r["primary_cost"] for r in vals]
        add(f"{label}: pairs with a fully separate backup",
            sum(r["disjoint"] for r in vals), e2["fully separate backups"])
        add(f"{label}: median stretch", round(statistics.median(stretch), 3), e2["median stretch"])
        add(f"{label}: switch rules, primary + backup",
            rd.forwarding_entries(table, True), rl["rules, primary + backup"])
    g, table, *_ = load("nigeria")
    r = table[("Lagos", "Maiduguri")]
    lm = k["lagos_maiduguri"]
    add("Lagos to Maiduguri: primary path", " > ".join(r["primary"]), " > ".join(lm["primary"]))
    add("Lagos to Maiduguri: backup path", " > ".join(r["backup"]), " > ".join(lm["backup"]))
    add("Lagos to Maiduguri: costs (km)",
        [round(r["primary_cost"], 1), round(r["backup_cost"], 1)],
        [lm["primary_cost"], lm["backup_cost"]])
    traps = sorted(f"{s} - {t}" for (s, t), x in table.items() if not x["disjoint"])
    add("Nigeria-20: pairs that share a link (traps)", traps,
        sorted(x["pair"] for x in k["e2_traps"]))
    return {"all_match": all(x["match"] for x in rows), "checks": rows}
