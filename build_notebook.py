"""Turn notebook_src.py (+ sections of redundant_dijkstra.py) into an executed .ipynb."""
import re, sys, nbformat
from nbclient import NotebookClient

mod = open("redundant_dijkstra.py").read()
sections = {}
for m in re.finditer(r"# %% CELL: (\w+)\n(.*?)(?=\n# %% CELL: |\Z)", mod, re.S):
    sections[m.group(1)] = m.group(2).strip("\n")

src = open("notebook_src.py").read()
chunks = re.split(r"^# %%(.*)$", src, flags=re.M)
cells = []
for i in range(1, len(chunks), 2):
    tag, body = chunks[i].strip(), chunks[i + 1].strip("\n")
    if tag == "[markdown]":
        text = "\n".join(l[2:] if l.startswith("# ") else l.lstrip("#") for l in body.splitlines())
        cells.append(nbformat.v4.new_markdown_cell(text.strip()))
    else:
        lines = []
        for l in body.splitlines():
            m = re.match(r"# INCLUDE: (\w+)", l)
            lines.append(sections[m.group(1)] if m else l)
        cells.append(nbformat.v4.new_code_cell("\n".join(lines).strip()))

nb = nbformat.v4.new_notebook(cells=cells)
nb.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
nb.metadata["language_info"] = {"name": "python"}
out = sys.argv[1] if len(sys.argv) > 1 else "Redundant_Paths_Dijkstra.ipynb"
if "--no-exec" not in sys.argv:
    NotebookClient(nb, timeout=1800, kernel_name="python3", resources={"metadata": {"path": "."}}).execute()
nbformat.write(nb, out)
print("wrote", out, len(cells), "cells")
