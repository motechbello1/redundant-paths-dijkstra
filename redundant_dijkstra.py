# =============================================================================
# redundant_dijkstra.py
# Optimizing Redundant Paths Using Dijkstra's Algorithm for Enhancing
# Network Reliability (MSc Computer Science, Baze University, Abuja)
#
# Everything in this file uses ONE routing algorithm: Dijkstra's algorithm.
# The same file is used by the Jupyter notebook and by the web app (app.py),
# so the results in the dissertation and the app always come from the same code.
# =============================================================================

# %% CELL: imports
import heapq
import itertools
import math
import random
import time

import networkx as nx
import numpy as np


# %% CELL: dijkstra
def dijkstra(graph, source, target=None, weight_fn=None):
    """Dijkstra's algorithm with a binary-heap priority queue.

    graph     : a NetworkX graph; every link carries a 'weight' (its cost).
    source    : the start node.
    target    : optional end node; the search stops as soon as it is settled.
    weight_fn : optional function (u, v, link_data) -> cost.
                Returning None means "this link cannot be used" (for example,
                because it has failed).

    Returns two dictionaries:
      dist[node] = cheapest known cost from the source to that node
      prev[node] = the node just before it on that cheapest route
    """
    if weight_fn is None:
        weight_fn = lambda u, v, data: data["weight"]

    dist = {source: 0.0}
    prev = {source: None}
    settled = set()                      # nodes whose cheapest cost is final
    tie = itertools.count()              # keeps the heap order stable on ties
    heap = [(0.0, next(tie), source)]    # (cost so far, tie-breaker, node)

    while heap:
        cost_u, _, u = heapq.heappop(heap)     # the cheapest unsettled node
        if u in settled:
            continue                           # an old, out-of-date heap entry
        settled.add(u)
        if u == target:
            break                              # we only needed this one node
        for v, data in graph[u].items():
            if v in settled:
                continue
            w = weight_fn(u, v, data)
            if w is None:
                continue                       # unusable link (e.g. failed)
            new_cost = cost_u + w
            if new_cost < dist.get(v, math.inf):   # the "relaxation" step
                dist[v] = new_cost
                prev[v] = u
                heapq.heappush(heap, (new_cost, next(tie), v))
    return dist, prev


# %% CELL: path_helpers
def build_path(prev, source, target):
    """Walk backwards through prev[] to rebuild the route source -> target."""
    if target not in prev:
        return None                            # target was never reached
    path = [target]
    while path[-1] != source:
        path.append(prev[path[-1]])
    return path[::-1]


def shortest_path(graph, source, target, weight_fn=None):
    """Cheapest route and its cost, found with Dijkstra's algorithm."""
    dist, prev = dijkstra(graph, source, target, weight_fn)
    path = build_path(prev, source, target)
    return path, (dist[target] if path else math.inf)


def path_links(path):
    """The set of links a route uses. Each link is stored as frozenset({u, v})."""
    return {frozenset(pair) for pair in zip(path, path[1:])}


def path_cost(graph, path):
    """Total cost of a route, using the real (un-penalised) link weights."""
    return sum(graph[u][v]["weight"] for u, v in zip(path, path[1:]))


# %% CELL: two_pass
def two_pass_redundant_paths(graph, source, target):
    """The two-pass Dijkstra procedure used in this study.

    Pass 1: run Dijkstra on the real link costs -> PRIMARY path.
    Pass 2: add a large penalty to every link the primary path uses, then run
            Dijkstra again -> BACKUP (redundant) path.

    The penalty is larger than the cost of every link in the network added
    together, so Pass 2 only reuses a primary link when there is no way
    around it. When a fully separate route exists, Pass 2 finds the cheapest
    such route. When it does not, Pass 2 shares as few links as possible.
    """
    primary, primary_cost = shortest_path(graph, source, target)
    if primary is None:
        return None
    primary_set = path_links(primary)
    penalty = graph.size(weight="weight") + 1.0

    def penalised_weight(u, v, data):
        extra = penalty if frozenset((u, v)) in primary_set else 0.0
        return data["weight"] + extra

    backup, _ = shortest_path(graph, source, target, weight_fn=penalised_weight)
    backup_set = path_links(backup)
    shared = primary_set & backup_set
    return {
        "primary": primary,
        "backup": backup,
        "primary_cost": primary_cost,
        "backup_cost": path_cost(graph, backup),
        "primary_links": primary_set,
        "backup_links": backup_set,
        "shared_links": shared,
        "disjoint": len(shared) == 0,
    }


def build_routing_table(graph):
    """Primary + backup path for every pair of nodes (computed in advance)."""
    table = {}
    for s, t in itertools.combinations(sorted(graph.nodes, key=str), 2):
        table[(s, t)] = two_pass_redundant_paths(graph, s, t)
    return table


# %% CELL: topologies
# A HYPOTHETICAL backbone joining 20 Nigerian cities. It does not describe any
# operator's real network. City positions are approximate (latitude, longitude).
NIGERIA_CITIES = {
    "Lagos": (6.524, 3.379), "Ibadan": (7.378, 3.947), "Ilorin": (8.497, 4.543),
    "Benin City": (6.335, 5.604), "Lokoja": (7.802, 6.733), "Abuja": (9.077, 7.399),
    "Minna": (9.614, 6.557), "Kaduna": (10.511, 7.417), "Kano": (12.002, 8.592),
    "Katsina": (12.991, 7.602), "Sokoto": (13.006, 5.248), "Jos": (9.897, 8.858),
    "Bauchi": (10.316, 9.844), "Maiduguri": (11.831, 13.151), "Yola": (9.204, 12.495),
    "Makurdi": (7.732, 8.539), "Enugu": (6.458, 7.546), "Owerri": (5.484, 7.033),
    "Port Harcourt": (4.816, 7.050), "Calabar": (4.976, 8.342),
}

NIGERIA_LINKS = [
    ("Lagos", "Ibadan"), ("Lagos", "Benin City"), ("Ibadan", "Ilorin"),
    ("Ibadan", "Benin City"), ("Ilorin", "Minna"), ("Ilorin", "Lokoja"),
    ("Benin City", "Lokoja"), ("Benin City", "Enugu"), ("Benin City", "Port Harcourt"),
    ("Owerri", "Port Harcourt"), ("Owerri", "Enugu"), ("Port Harcourt", "Calabar"),
    ("Calabar", "Enugu"), ("Enugu", "Makurdi"), ("Lokoja", "Abuja"),
    ("Abuja", "Minna"), ("Abuja", "Kaduna"), ("Abuja", "Jos"), ("Abuja", "Makurdi"),
    ("Sokoto", "Katsina"), ("Sokoto", "Minna"), ("Kaduna", "Kano"),
    ("Kano", "Katsina"), ("Kaduna", "Jos"), ("Kano", "Bauchi"), ("Jos", "Bauchi"),
    ("Bauchi", "Maiduguri"), ("Maiduguri", "Yola"), ("Yola", "Bauchi"),
    ("Yola", "Makurdi"), ("Makurdi", "Jos"),
]


def haversine_km(a, b):
    """Great-circle distance in km between two (latitude, longitude) points."""
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def nigeria_backbone():
    """Build the hypothetical 20-city backbone; link cost = distance in km."""
    g = nx.Graph(name="Hypothetical Nigerian backbone")
    for city, (lat, lon) in NIGERIA_CITIES.items():
        g.add_node(city, pos=(lon, lat))
    for a, b in NIGERIA_LINKS:
        km = haversine_km(NIGERIA_CITIES[a], NIGERIA_CITIES[b])
        g.add_edge(a, b, weight=round(km, 1))
    return g


def scale_free_network(n, m=2, seed=42):
    """Synthetic Barabasi-Albert network; link costs are whole numbers 1 to 10."""
    g = nx.barabasi_albert_graph(n, m, seed=seed)
    g.graph["name"] = f"Barabasi-Albert n={n}, m={m}"
    rng = random.Random(seed)
    for u, v in sorted(g.edges):
        g[u][v]["weight"] = rng.randint(1, 10)
    return g


# %% CELL: failure_tests
def single_failure_test(graph, table):
    """Break each link on its own, one at a time, and count what happens.

    affected  = pairs whose primary path used the broken link
    protected = affected pairs whose backup path does NOT use the broken link
                (they keep working at once, with no new calculation)
    """
    rows = []
    for u, v in graph.edges:
        broken = frozenset((u, v))
        affected = protected = 0
        for r in table.values():
            if broken in r["primary_links"]:
                affected += 1
                if broken not in r["backup_links"]:
                    protected += 1
        rows.append({"link": f"{u} - {v}", "affected": affected,
                     "protected": protected})
    return rows


def multi_failure_trial(graph, table, k, rng):
    """Break k random links at the same time and measure three things.

    single_path : share of pairs whose primary path still works
    redundant   : share of pairs whose primary OR backup path still works
    reachable   : share of pairs still joined by ANY route (the best that a
                  full re-run of Dijkstra could ever achieve)
    """
    edges = sorted(graph.edges, key=str)
    failed = {frozenset(e) for e in rng.sample(edges, k)}
    damaged = graph.copy()
    damaged.remove_edges_from(tuple(e) for e in failed)
    island = {}
    for i, part in enumerate(nx.connected_components(damaged)):
        for node in part:
            island[node] = i
    n = len(table)
    single = redundant = reachable = 0
    for (s, t), r in table.items():
        p_ok = not (r["primary_links"] & failed)
        b_ok = not (r["backup_links"] & failed)
        single += p_ok
        redundant += (p_ok or b_ok)
        reachable += island[s] == island[t]
    return single / n, redundant / n, reachable / n


# %% CELL: timing
def median_ms(fn, repeat=7):
    """Run fn() several times and return the median time in milliseconds."""
    times = []
    for _ in range(repeat):
        t0 = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t0) * 1000.0)
    return float(np.median(times))


def recovery_compute_test(graph, table, repeat=7):
    """For every single-link failure, time the two ways of recovering.

    restoration : re-run Dijkstra (on the network without the broken link)
                  for every affected pair  -> what plain Dijkstra must do
    protection  : look up the stored backup for every affected pair
                  -> what the two-pass procedure does
    """
    rows = []
    for u, v in graph.edges:
        broken = frozenset((u, v))
        hit = [(s, t) for (s, t), r in table.items() if broken in r["primary_links"]]
        if not hit:
            continue
        skip = lambda a, b, d: None if frozenset((a, b)) == broken else d["weight"]
        restore = lambda: [shortest_path(graph, s, t, weight_fn=skip) for s, t in hit]
        protect = lambda: [table[p]["backup"] for p in hit
                           if broken not in table[p]["backup_links"]]
        rows.append({"link": f"{u} - {v}", "affected": len(hit),
                     "restoration_ms": median_ms(restore, repeat),
                     "protection_ms": median_ms(protect, repeat)})
    return rows


# %% CELL: simulation
def make_failure_schedule(graph, duration_s, n_failures, repair_range_s, rng):
    """Pick random moments to cut random links, and a repair time for each cut.

    n_failures     : how many cuts happen during the run
    repair_range_s : (shortest, longest) repair time in seconds
    A link that is already cut is never cut again until it is repaired.
    """
    edges = sorted(graph.edges, key=str)
    cut_times = sorted(rng.uniform(0.0, duration_s) for _ in range(n_failures))
    down_until, events = {}, []
    for t in cut_times:
        choices = [frozenset(e) for e in edges if down_until.get(frozenset(e), -1.0) <= t]
        link = rng.choice(choices)
        repair_t = t + rng.uniform(*repair_range_s)
        down_until[link] = repair_t
        events.append((t, "fail", link))
        if repair_t < duration_s:
            events.append((repair_t, "repair", link))
    events.sort(key=lambda e: (e[0], e[1] == "fail"))   # repairs first on ties
    return events


def simulate_failures(graph, table, method, schedule, duration_s,
                      detect_s, install_s, compute_s, counts=None):
    """Event-driven simulation of link failures and repairs.

    method = "single"    : plain Dijkstra with one path. When the path breaks,
                           the flow is down for detect + compute + install time;
                           then Dijkstra is re-run on the links still working.
    method = "redundant" : two-pass Dijkstra. When the primary breaks and the
                           backup still works, the flow is down only for the
                           detection time (local switch-over). If both are
                           broken, it falls back to a full re-run, like "single".
    After a repair, every working flow moves back to its best path; this move
    is planned in advance, so no packets are lost during it.

    Returns {pair: [(down_start, down_end), ...]} in seconds.
    If a dictionary is passed as counts, it is filled with how many
    interruptions were handled by a fast switch-over and how many by a re-run.
    """
    if counts is None:
        counts = {}
    for key in ("switch", "rerun"):
        counts.setdefault(key, 0)
    failed = set()
    working = lambda a, b, d: None if frozenset((a, b)) in failed else d["weight"]
    restore_delay = detect_s + compute_s + install_s

    def best_path(pair):
        r = table[pair]
        if method == "redundant":
            if not (r["primary_links"] & failed):
                return r["primary"]
            if not (r["backup_links"] & failed):
                return r["backup"]
        p, _ = shortest_path(graph, pair[0], pair[1], weight_fn=working)
        return p

    current = {pair: table[pair]["primary"] for pair in table}
    down_since, waiting = {}, {}        # outage start; scheduled recovery kind
    pending, seq = [], itertools.count()
    outages = {pair: [] for pair in table}

    def schedule_recovery(pair, t, delay, kind):
        down_since.setdefault(pair, t)
        current[pair] = None
        waiting[pair] = kind
        heapq.heappush(pending, (t + delay, next(seq), pair, kind))

    def finish_recoveries(until):
        while pending and pending[0][0] <= until:
            t_rec, _, pair, kind = heapq.heappop(pending)
            if waiting.get(pair) != kind:
                continue
            del waiting[pair]
            if kind == "switch":
                if table[pair]["backup_links"] & failed:   # backup broke too
                    schedule_recovery(pair, t_rec, compute_s + install_s, "restore")
                    counts["switch"] -= 1
                    counts["rerun"] += 1
                    continue
                p = table[pair]["backup"]
            else:
                p = best_path(pair)
            if p is None:
                continue                  # no route at all: wait for a repair
            current[pair] = p
            outages[pair].append((down_since.pop(pair), t_rec))

    for t, kind, link in schedule:
        finish_recoveries(t)
        if kind == "fail":
            failed.add(link)
            for pair, p in current.items():
                if p is None or link not in path_links(p):
                    continue
                r = table[pair]
                if (method == "redundant" and p == r["primary"]
                        and not (r["backup_links"] & failed)):
                    schedule_recovery(pair, t, detect_s, "switch")
                    counts["switch"] += 1
                else:
                    schedule_recovery(pair, t, restore_delay, "restore")
                    counts["rerun"] += 1
        else:
            failed.discard(link)
            for pair in table:
                if pair in down_since:
                    if pair not in waiting:          # was cut off completely
                        schedule_recovery(pair, t, compute_s + install_s, "restore")
                else:
                    current[pair] = best_path(pair)
    finish_recoveries(duration_s)
    for pair, t0 in down_since.items():
        outages[pair].append((t0, duration_s))
    return outages


def count_lost_packets(outages, rate_pps, duration_s):
    """Every flow sends packets at a steady rate (like a ticking clock).

    A packet is lost if it is sent while its flow is down.
    Returns (packets sent, packets lost).
    """
    times = np.arange(0.0, duration_s, 1.0 / rate_pps)      # same clock for all
    sent = len(times) * len(outages)
    lost = 0
    for intervals in outages.values():
        for a, b in intervals:
            lost += int(np.searchsorted(times, b) - np.searchsorted(times, a))
    return sent, lost


def unavoidable_outages(graph, table, schedule, duration_s):
    """Periods when two cities are cut off from each other completely.

    During these periods NO routing method could deliver packets, so they set
    the floor for packet loss in the simulation.
    """
    failed = set()
    outages = {pair: [] for pair in table}
    times = [e[0] for e in schedule] + [duration_s]
    start = 0.0
    for i, (t, kind, link) in enumerate(schedule):
        failed.add(link) if kind == "fail" else failed.discard(link)
        end = times[i + 1]
        if not failed or end <= t:
            continue
        damaged = graph.copy()
        damaged.remove_edges_from(tuple(e) for e in failed)
        island = {n: k for k, part in enumerate(nx.connected_components(damaged))
                  for n in part}
        for (s, d) in table:
            if island[s] != island[d]:
                outages[(s, d)].append((t, end))
    return outages


# %% CELL: extras
def dijkstra_trace(graph, source):
    """Dijkstra step by step, for teaching: which node is settled at each step
    and the best cost known for every node right after that step."""
    dist = {n: math.inf for n in graph.nodes}
    dist[source] = 0.0
    prev = {source: None}
    settled, steps = [], []
    heap = [(0.0, str(source), source)]
    while heap:
        d, _, u = heapq.heappop(heap)
        if u in settled:
            continue
        settled.append(u)
        for v, data in graph[u].items():
            if v not in settled and d + data["weight"] < dist[v]:
                dist[v] = d + data["weight"]
                prev[v] = u
                heapq.heappush(heap, (dist[v], str(v), v))
        steps.append({"step": len(settled), "settled": u, "dist": dict(dist)})
    return steps


def forwarding_entries(table, redundant=True):
    """Rough count of switch rules needed: one rule per switch on each path
    (the destination switch needs none)."""
    total = 0
    for r in table.values():
        total += len(r["primary"]) - 1
        if redundant:
            total += len(r["backup"]) - 1
    return total
