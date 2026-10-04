"""Concept diagrams for the dissertation and slides (no data; drawn with matplotlib)."""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

os.makedirs("figures/print", exist_ok=True)
os.makedirs("figures/screen", exist_ok=True)

THEMES = {
    "print": {"font": "serif", "fill": "#ffffff", "fill2": "#e6e6e6", "fill3": "#cfcfcf", "edge": "#000000",
              "accent": "#000000", "muted": "#555555"},
    "screen": {"font": "sans-serif", "fill": "#ffffff", "fill2": "#e3eefb", "fill3": "#fde3d7",
               "edge": "#1f1f1f", "accent": "#eb6834", "muted": "#555555"},
}


def setup(kind, w, h):
    plt.rcParams.update({"font.family": THEMES[kind]["font"],
                         "font.serif": ["Times New Roman", "Liberation Serif", "DejaVu Serif"],
                         "font.sans-serif": ["DejaVu Sans"], "font.size": 9})
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, w)
    ax.set_ylim(0, h)
    ax.axis("off")
    return fig, ax, THEMES[kind]


def box(ax, x, y, w, h, text, fill, edge="#000000", size=9, bold=False, ls="-"):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.08",
                                fc=fill, ec=edge, lw=1.1, ls=ls))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=size,
            fontweight="bold" if bold else "normal", wrap=True)


def arrow(ax, x1, y1, x2, y2, text=None, color="#000000", ls="-", both=False, size=8, offset=(0.08, 0)):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="<|-|>" if both else "-|>",
                                 mutation_scale=11, lw=1.1, color=color, ls=ls))
    if text:
        ax.text((x1 + x2) / 2 + offset[0], (y1 + y2) / 2 + offset[1], text, fontsize=size, va="center")


def save(fig, kind, name):
    fig.savefig(f"figures/{kind}/{name}.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


def sdn_architecture(kind):
    fig, ax, c = setup(kind, 7.0, 5.0)
    box(ax, 0.3, 4.05, 6.4, 0.75, "", c["fill"])
    ax.text(0.45, 4.62, "Application plane", fontsize=9, fontweight="bold", va="center")
    for i, t in enumerate(["Monitoring", "Traffic engineering", "Reliability services"]):
        box(ax, 0.55 + i * 2.05, 4.12, 1.85, 0.38, t, c["fill2"], size=8)
    arrow(ax, 3.5, 4.05, 3.5, 3.55, "Northbound interface (APIs)", both=True)
    box(ax, 0.3, 2.05, 6.4, 1.5, "", c["fill"])
    ax.text(0.45, 3.33, "Control plane: SDN controller (global view of the network)", fontsize=9,
            fontweight="bold", va="center")
    for i, t in enumerate(["Topology\nstore", "Dijkstra\nrouting engine", "Flow rule\nmanager"]):
        box(ax, 0.6 + i * 2.05, 2.2, 1.8, 0.85, t, c["fill2"] if i != 1 else c["fill3"], size=8.5)
    arrow(ax, 3.5, 2.05, 3.5, 1.5, "Southbound interface (OpenFlow)", both=True)
    box(ax, 0.3, 0.1, 6.4, 1.4, "", c["fill"])
    ax.text(0.45, 1.3, "Data plane: switches forward packets using flow tables", fontsize=9,
            fontweight="bold", va="center")
    xs = [0.9, 2.5, 4.1, 5.7]
    for x in xs:
        box(ax, x - 0.42, 0.3, 0.84, 0.55, "Switch", c["fill2"], size=8)
    for a, b in zip(xs, xs[1:]):
        ax.plot([a + 0.42, b - 0.42], [0.575, 0.575], color=c["muted"], lw=1.2)
    save(fig, kind, "fig_sdn_architecture")


def protection_vs_restoration(kind):
    fig, ax, c = setup(kind, 7.6, 3.5)
    y1, y2 = 2.45, 0.95
    ax.text(0.05, 3.25, "Time after the link fails (not to scale)", fontsize=8.5, color=c["muted"])
    for y, title in [(y1, "Restoration\n(plain Dijkstra)"), (y2, "Protection\n(two-pass Dijkstra)")]:
        ax.text(0.05, y + 0.22, title, fontsize=9, fontweight="bold", va="center")
        ax.plot([1.55, 7.45], [y, y], color=c["muted"], lw=0.8)
    ax.plot([1.6, 1.6], [0.45, 3.05], color=c["edge"], lw=1.4, ls="--")
    ax.text(1.62, 3.08, "Link fails", fontsize=8.5)
    segs1 = [(1.6, 2.9, "Detect\n(about 50 ms)", c["fill2"]), (2.9, 3.9, "Tell\ncontroller", c["fill2"]),
             (3.9, 4.9, "Re-run\nDijkstra", c["fill2"]), (4.9, 6.2, "Install\nnew rules", c["fill2"])]
    for a, b, t, f in segs1:
        box(ax, a, y1 - 0.02, b - a, 0.5, t, f, size=7.5)
    ax.annotate("", xy=(6.2, y1 - 0.25), xytext=(1.6, y1 - 0.25),
                arrowprops=dict(arrowstyle="<|-|>", color=c["edge"], lw=1))
    ax.text(3.9, y1 - 0.42, "traffic stopped: at least about 100 ms; 200 to 300 ms is realistic in large networks",
            fontsize=7.5, ha="center")
    box(ax, 6.25, y1 - 0.02, 1.15, 0.5, "Traffic\nflows again", c["fill"], size=7.5)
    box(ax, 1.6, y2 - 0.02, 1.3, 0.5, "Detect\n(about 50 ms)", c["fill2"], size=7.5)
    box(ax, 2.95, y2 - 0.02, 1.6, 0.5, "Switch to stored\nbackup path", c["fill3"], size=7.5)
    box(ax, 4.6, y2 - 0.02, 1.15, 0.5, "Traffic\nflows again", c["fill"], size=7.5)
    ax.annotate("", xy=(2.95, y2 - 0.25), xytext=(1.6, y2 - 0.25),
                arrowprops=dict(arrowstyle="<|-|>", color=c["edge"], lw=1))
    ax.text(1.7, y2 - 0.42, "traffic stopped: about the detection time", fontsize=7.5, ha="left")
    save(fig, kind, "fig_protection_restoration")


def research_design(kind):
    fig, ax, c = setup(kind, 7.6, 2.7)
    steps = ["Problem:\none path,\nslow recovery", "Design:\ntwo-pass\nDijkstra", "Implement:\nPython,\nNetworkX",
             "Test networks:\nNigeria-20,\nBA-50", "Experiments\nE1 to E6", "Analyse:\nstatistics,\ncharts",
             "Deploy:\nweb app"]
    w, gap = 0.95, 0.12
    for i, t in enumerate(steps):
        x = 0.1 + i * (w + gap)
        box(ax, x, 1.1, w, 1.1, t, c["fill3"] if i in (1, 4) else c["fill2"], size=7.5)
        if i < len(steps) - 1:
            arrow(ax, x + w, 1.65, x + w + gap, 1.65)
    ax.text(3.8, 0.55, "Objective i: design (step 2)    Objective ii: implement and deploy (steps 3, 4, 7)    "
            "Objective iii: evaluate (steps 5, 6)", fontsize=7.5, ha="center", color=c["muted"])
    save(fig, kind, "fig_research_design")


def system_architecture(kind):
    fig, ax, c = setup(kind, 7.4, 5.2)
    box(ax, 0.2, 4.2, 3.3, 0.8, "Jupyter notebook\n(experiments E1 to E6)", c["fill2"], size=8.5)
    box(ax, 3.9, 4.2, 3.3, 0.8, "Streamlit web app\n(route planner, cut a link)", c["fill2"], size=8.5)
    box(ax, 0.2, 1.75, 7.0, 2.1, "", c["fill"])
    ax.text(0.35, 3.62, "redundant_dijkstra.py (controller logic, one shared module)", fontsize=9,
            fontweight="bold", va="center")
    box(ax, 0.4, 2.0, 1.45, 1.3, "Topology\n(nodes, links,\ncosts)", c["fill2"], size=8)
    box(ax, 2.1, 2.0, 1.45, 1.3, "Dijkstra\n(binary heap)", c["fill3"], size=8)
    box(ax, 3.8, 2.0, 1.45, 1.3, "Two-pass\nprocedure\n(penalty P)", c["fill3"], size=8)
    box(ax, 5.5, 2.0, 1.5, 1.3, "Routing table\nprimary +\nbackup per pair", c["fill2"], size=8)
    arrow(ax, 1.85, 2.65, 2.1, 2.65)
    arrow(ax, 3.55, 2.65, 3.8, 2.65)
    arrow(ax, 5.25, 2.65, 5.5, 2.65)
    arrow(ax, 1.85, 4.2, 1.85, 3.85)
    arrow(ax, 5.55, 4.2, 5.55, 3.85)
    box(ax, 0.2, 0.15, 7.0, 1.15, "", c["fill"], ls="--")
    ax.text(0.35, 1.1, "Simulated data plane: link failures, repairs, packets (event-driven)", fontsize=9,
            fontweight="bold", va="center")
    ax.text(3.7, 0.5, "Each flow has a primary rule and a pre-installed backup rule. On a cut: switch at once\n"
            "if the backup works; otherwise ask the controller for a Dijkstra re-run.", fontsize=7.5, ha="center")
    arrow(ax, 6.25, 1.75, 6.25, 1.3, both=True)
    save(fig, kind, "fig_system_architecture")


def two_pass_flowchart(kind):
    fig, ax, c = setup(kind, 5.6, 7.4)
    cx, w = 2.8, 3.6
    items = [(6.75, "Start: network G, source s, destination t", c["fill"]),
             (5.85, "Pass 1: run Dijkstra on the real link costs\n-> primary path P1", c["fill3"]),
             (4.95, "Penalty P = (sum of all link costs) + 1\nAdd P to the cost of every link in P1", c["fill2"]),
             (4.05, "Pass 2: run Dijkstra on the penalised costs\n-> backup path P2", c["fill3"]),
             (3.15, "Compare: which links do P1 and P2 share?", c["fill2"])]
    for y, t, f in items:
        box(ax, cx - w / 2, y, w, 0.62, t, f, size=8)
    for (y_a, _, _), (y_b, _, _) in zip(items, items[1:]):
        arrow(ax, cx, y_a, cx, y_b + 0.62)
    box(ax, 0.1, 1.75, 2.45, 0.85, "None shared:\nfully separate backup;\ncovers any single cut on P1", c["fill"], size=7.5)
    box(ax, 3.05, 1.75, 2.45, 0.85, "Some shared:\nfewest possible shared\nlinks (a 'trap' or a bridge)", c["fill"], size=7.5)
    arrow(ax, cx - 0.4, 3.15, 1.35, 2.6)
    arrow(ax, cx + 0.4, 3.15, 4.25, 2.6)
    box(ax, cx - w / 2, 0.45, w, 0.62, "Store P1 and P2 in the routing table\n(install both rules in the switches)",
        c["fill2"], size=8)
    arrow(ax, 1.35, 1.75, cx - 0.6, 1.07)
    arrow(ax, 4.25, 1.75, cx + 0.6, 1.07)
    save(fig, kind, "fig_two_pass_flowchart")


for k in ("print", "screen"):
    sdn_architecture(k)
    protection_vs_restoration(k)
    research_design(k)
    system_architecture(k)
    two_pass_flowchart(k)
print("diagrams done")
