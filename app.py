"""
Redundant Path Planner: the deployed web application for the dissertation
"Optimizing Redundant Paths Using Dijkstra's Algorithm for Enhancing Network Reliability".

Run it with:   streamlit run app.py
It uses exactly the same routing code as the notebook (redundant_dijkstra.py).
"""
import json
import math
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.patheffects as pe
import matplotlib.pyplot as plt
import networkx as nx
import pandas as pd
import streamlit as st

import redundant_dijkstra as rd

st.set_page_config(page_title="Redundant Path Planner (Dijkstra)", layout="wide")

PRIMARY_COLOUR, BACKUP_COLOUR, NEW_COLOUR = "#222222", "#eb6834", "#2a78d6"
HERE = os.path.dirname(os.path.abspath(__file__))


# ----------------------------------------------------------------------------
# Networks and routing tables (built once, then cached)
# ----------------------------------------------------------------------------
def abuja_districts():
    g = nx.Graph(name="Six Abuja districts (teaching example)")
    for a, b, w in [("Garki", "Wuse", 4), ("Garki", "Asokoro", 2), ("Asokoro", "Wuse", 1),
                    ("Wuse", "Jabi", 5), ("Asokoro", "Maitama", 7), ("Wuse", "Maitama", 3),
                    ("Jabi", "Gwarinpa", 3), ("Maitama", "Gwarinpa", 6)]:
        g.add_edge(a, b, weight=w)
    pos = {"Garki": (0, 0), "Asokoro": (1, -1), "Wuse": (1, 1), "Maitama": (2.2, 0.3),
           "Jabi": (2.2, 1.6), "Gwarinpa": (3.4, 1.0)}
    nx.set_node_attributes(g, pos, "pos")
    return g


@st.cache_resource
def load_network(name):
    if name == "Hypothetical Nigerian backbone (20 cities)":
        g, unit = rd.nigeria_backbone(), "km"
    elif name == "Synthetic scale-free network (50 nodes)":
        g, unit = rd.scale_free_network(50, m=2, seed=42), "cost units"
        nx.set_node_attributes(g, nx.spring_layout(g, seed=7), "pos")
    else:
        g, unit = abuja_districts(), "cost units"
    return g, rd.build_routing_table(g), unit


def lookup(table, s, t):
    """Routing tables store each pair once; flip the paths if asked the other way."""
    if (s, t) in table:
        return table[(s, t)]
    r = dict(table[(t, s)])
    r["primary"], r["backup"] = r["primary"][::-1], r["backup"][::-1]
    return r


# ----------------------------------------------------------------------------
# Drawing
# ----------------------------------------------------------------------------
def draw(g, paths, cut=(), title=""):
    pos = nx.get_node_attributes(g, "pos")
    fig, ax = plt.subplots(figsize=(7.5, 6.0))
    nx.draw_networkx_edges(g, pos, ax=ax, edge_color="#bdbdbd", width=1.0)
    for path, colour, style, label in paths:
        if path:
            nx.draw_networkx_edges(g, pos, edgelist=list(zip(path, path[1:])), ax=ax, width=3.2,
                                   edge_color=colour, style=style, label=label)
    for u, v in cut:
        (x1, y1), (x2, y2) = pos[u], pos[v]
        ax.plot([x1, x2], [y1, y2], color="black", linewidth=1.5, linestyle=":")
        ax.plot((x1 + x2) / 2, (y1 + y2) / 2, marker="X", markersize=13, color="black")
    small = g.number_of_nodes() > 25
    nx.draw_networkx_nodes(g, pos, ax=ax, node_size=40 if small else 90, node_color="white",
                           edgecolors="black", linewidths=1.0)
    if not small:
        for n, (x, y) in pos.items():
            ax.annotate(str(n), (x, y), xytext=(5, 5), textcoords="offset points", fontsize=8,
                        path_effects=[pe.withStroke(linewidth=3, foreground="white")])
    if any(p[0] for p in paths):
        ax.legend(loc="lower right", fontsize=8, frameon=False)
    ax.set_title(title, fontsize=10)
    ax.axis("off")
    return fig


# ----------------------------------------------------------------------------
# Page
# ----------------------------------------------------------------------------
st.title("Redundant Path Planner")
st.caption("Two-pass Dijkstra: Pass 1 finds the primary path; Pass 2 penalises the primary links and "
           "finds a separate backup path. Only Dijkstra's algorithm is used. The Nigerian backbone is "
           "hypothetical and does not describe any operator's real network.")

with st.sidebar:
    st.header("Choose a network")
    net_name = st.selectbox("Network", ["Hypothetical Nigerian backbone (20 cities)",
                                        "Synthetic scale-free network (50 nodes)",
                                        "Six Abuja districts (teaching example)"])
    G, TABLE, UNIT = load_network(net_name)
    nodes = sorted(G.nodes, key=str)
    default_s = "Lagos" if "Lagos" in nodes else nodes[0]
    default_t = "Maiduguri" if "Maiduguri" in nodes else nodes[-1]
    source = st.selectbox("From", nodes, index=nodes.index(default_s))
    target = st.selectbox("To", [n for n in nodes if n != source],
                          index=[n for n in nodes if n != source].index(default_t)
                          if default_t != source else 0)
    st.markdown(f"**{G.number_of_nodes()} nodes, {G.number_of_edges()} links.** "
                f"Routing table holds {len(TABLE):,} pairs, each with a primary and a backup path.")

r = lookup(TABLE, source, target)
tab1, tab2, tab3, tab4 = st.tabs(["Route planner", "Cut a link", "Dijkstra step by step",
                                  "Experiment results"])

with tab1:
    c1, c2 = st.columns([3, 2])
    with c1:
        st.pyplot(draw(G, [(r["primary"], PRIMARY_COLOUR, "solid", "Primary (Pass 1)"),
                           (r["backup"], BACKUP_COLOUR, "dashed", "Backup (Pass 2)")],
                       title=f"{source} to {target}"))
    with c2:
        st.metric("Primary path cost", f"{r['primary_cost']:,.1f} {UNIT}")
        st.metric("Backup path cost", f"{r['backup_cost']:,.1f} {UNIT}",
                  delta=f"{100 * (r['backup_cost'] / r['primary_cost'] - 1):+.0f}% longer",
                  delta_color="off")
        st.write("**Primary:** " + " → ".join(map(str, r["primary"])))
        st.write("**Backup:** " + " → ".join(map(str, r["backup"])))
        if r["disjoint"]:
            st.success("The backup shares no link with the primary, so any single link failure on the "
                       "primary is covered at once.")
        else:
            shared = ", ".join(" - ".join(map(str, sorted(x, key=str))) for x in r["shared_links"])
            st.warning(f"The backup still shares: {shared}. If that link fails, both paths break and "
                       "Dijkstra must be re-run.")

with tab2:
    st.write("Pick one or more links to cut. The page shows what each method does next.")
    link_names = {f"{u} - {v}": (u, v) for u, v in sorted(G.edges, key=lambda e: (str(e[0]), str(e[1])))}
    on_primary = [f"{u} - {v}" for u, v in link_names.values()
                  if frozenset((u, v)) in rd.path_links(r["primary"])]
    chosen = st.multiselect("Links to cut", list(link_names), default=on_primary[:1])
    cut = [link_names[c] for c in chosen]
    failed = {frozenset(e) for e in cut}
    primary_ok = not (rd.path_links(r["primary"]) & failed)
    backup_ok = not (rd.path_links(r["backup"]) & failed)
    working = lambda a, b, d: None if frozenset((a, b)) in failed else d["weight"]
    new_path, new_cost = rd.shortest_path(G, source, target, weight_fn=working)

    c1, c2 = st.columns(2)
    with c1:
        st.subheader("Plain Dijkstra (one path)")
        if primary_ok:
            st.success("Primary path still works. Nothing to do.")
        elif new_path:
            st.error("Primary path broken. Traffic stops until the failure is detected, Dijkstra is "
                     "re-run and new rules are installed (about 100 to 300 ms in published surveys).")
            st.write(f"New path after the re-run: {' → '.join(map(str, new_path))} "
                     f"({new_cost:,.1f} {UNIT})")
        else:
            st.error("No route exists at all. Traffic stops until a link is repaired.")
    with c2:
        st.subheader("Two-pass Dijkstra (primary + backup)")
        if primary_ok:
            st.success("Primary path still works. Nothing to do.")
        elif backup_ok:
            st.success("Primary broken, backup intact: traffic switches to the stored backup straight "
                       "after detection. No new calculation needed.")
        elif new_path:
            st.warning("Both stored paths are broken. Falls back to a Dijkstra re-run, like plain "
                       "Dijkstra.")
        else:
            st.error("No route exists at all. Traffic stops until a link is repaired.")
    surviving = r["primary"] if primary_ok else (r["backup"] if backup_ok else new_path)
    st.pyplot(draw(G, [(surviving, NEW_COLOUR if not (primary_ok or backup_ok) else
                        (PRIMARY_COLOUR if primary_ok else BACKUP_COLOUR), "solid",
                        "Path now carrying traffic")], cut=cut,
                   title="Cut links are marked X"))

with tab3:
    st.write(f"Dijkstra's algorithm from **{source}**: at each step the cheapest unsettled node is "
             "settled, and its neighbours' costs are updated if a cheaper way is found.")
    steps = rd.dijkstra_trace(G, source)
    show = nodes if len(nodes) <= 20 else nodes[:20]
    rows = []
    for s in steps:
        row = {"step": s["step"], "settled": str(s["settled"])}
        row.update({str(n): ("∞" if s["dist"][n] == math.inf else f"{s['dist'][n]:,.1f}") for n in show})
        rows.append(row)
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)
    if len(nodes) > 20:
        st.caption("Only the first 20 node columns are shown.")

with tab4:
    path = os.path.join(HERE, "results", "key_numbers.json")
    if not os.path.exists(path):
        st.info("Run the notebook first to create results/key_numbers.json.")
    else:
        k = json.load(open(path))
        e3 = {row["network"]: row for row in k["e3"]}
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Correctness vs NetworkX", f"{min(x['agreement %'] for x in k['e1']):.0f}% of pairs")
        c2.metric("Fully separate backups (Nigeria)", f"{k['e2'][0]['fully separate %']:.2f}%")
        c3.metric("Single failures covered at once (Nigeria)", f"{e3['Nigeria-20']['protected %']:.2f}%")
        c4.metric("Avoidable packet loss cut (100 ms)", f"{k['e6_main_reduction_pct']:.1f}%")
        for fig_name, caption in [("fig_multi_failure", "Connections still working when several links break"),
                                  ("fig_simulation", "Packets lost to recovery delay in the 300-second runs"),
                                  ("fig_recovery_time", "Computer time: re-running Dijkstra vs switching")]:
            fp = os.path.join(HERE, "figures", "screen", fig_name + ".png")
            if os.path.exists(fp):
                st.image(fp, caption=caption, use_container_width=True)
