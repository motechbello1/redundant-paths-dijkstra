"""
Run the Vercel website on your own computer, with no internet needed.

    pip install fastapi uvicorn networkx numpy
    python serve_local.py

then open http://localhost:8000 in a browser. It serves exactly the same
files as the live Vercel site: the API in api/index.py (which imports
redundant_dijkstra.py) and the web page in public/.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "api"))

import uvicorn                                   # noqa: E402
from fastapi.staticfiles import StaticFiles      # noqa: E402

from index import app                            # noqa: E402  (api/index.py)

app.mount("/figures", StaticFiles(directory=os.path.join(HERE, "figures")), name="figures")
app.mount("/results", StaticFiles(directory=os.path.join(HERE, "results")), name="results")
app.mount("/", StaticFiles(directory=os.path.join(HERE, "public"), html=True), name="site")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"Redundant Path Planner running at http://localhost:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port)
