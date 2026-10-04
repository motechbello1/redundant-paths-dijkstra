# Optimizing Redundant Paths Using Dijkstra's Algorithm for Enhancing Network Reliability

MSc Computer Science project, Maryam Sirajo (BU/23C/PGS/9469), Baze University, Abuja.

Only Dijkstra's algorithm is used for routing. Pass 1 finds the primary path. Pass 2 adds a penalty
(the sum of all link costs plus one) to every primary link and runs Dijkstra again, which finds a backup
path that shares as few links as possible with the primary.

**Live website:** https://redundant-paths-dijkstra.vercel.app

## Files

| File or folder | What it is |
|---|---|
| `Redundant_Paths_Dijkstra.ipynb` | The notebook: all code, all six experiments (E1 to E6), results and plain-English notes |
| `redundant_dijkstra.py` | The routing module. The notebook, the Streamlit app and the Vercel website all use this one file |
| `api/index.py` | The website's Python API (FastAPI). It imports `redundant_dijkstra.py`; it does not re-implement routing |
| `api/requirements.txt` | The three libraries the API needs on Vercel |
| `public/` | The website's page: `index.html`, `app.js`, `styles.css` |
| `vercel.json` | Tells Vercel to run `api/index.py` as a Python function and serve `public/` as the page |
| `serve_local.py` | Runs the same website on your own computer, with no internet |
| `app.py` | The Streamlit version of the app (Figures 4.7 and 4.8 in the dissertation) |
| `requirements.txt` | Every library needed to run the notebook, the Streamlit app and the local website |
| `results/` | All result tables (CSV) and `key_numbers.json`, written by the notebook |
| `figures/print/` | Black-and-white charts used in the dissertation |
| `figures/screen/` | Colour charts used in the slides, the app and the website |
| `diagrams.py`, `notebook_src.py`, `build_notebook.py` | Scripts that draw the method diagrams and build the notebook |

## The website

The website has five tabs:

1. **Route planner**: pick two places and see the primary path (solid) and the backup path (dashed), their costs, and whether they share any link.
2. **Cut a link**: click links on the map to cut them and compare what plain Dijkstra and two-pass Dijkstra do, with the interruption time under the four restoration settings tested in E6.
3. **Dijkstra step by step**: watch Dijkstra settle one node at a time, with every cost update.
4. **Experiment results**: the headline numbers from E1 to E6, the charts, and a **live check** that rebuilds both routing tables on the server and compares them with the numbers the notebook saved.
5. **How it works**: the method in plain English, and its limits.

API endpoints (documentation at `/api/docs` on the live site):

| Endpoint | Returns |
|---|---|
| `GET /api/health` | Versions and a Lagos to Maiduguri self-test |
| `GET /api/networks` | The three networks |
| `GET /api/network/{net}` | Nodes, links and a summary of the routing table (`net` = `nigeria`, `ba50` or `abuja`) |
| `GET /api/route?net=&source=&target=` | Primary and backup path for one pair |
| `POST /api/cut` | What each method does when the listed links are cut |
| `GET /api/trace?net=&source=` | Dijkstra step by step |
| `GET /api/check` | The live check against `results/key_numbers.json` |

## Run it

1. `pip install -r requirements.txt`
2. Notebook: open `Redundant_Paths_Dijkstra.ipynb` in Jupyter or Google Colab (upload `redundant_dijkstra.py` to the same folder) and run all cells. About two minutes.
3. Website on your own computer: `python serve_local.py`, then open http://localhost:8000
4. Streamlit version: `streamlit run app.py`, then open http://localhost:8501

## Deployment

The website runs on Vercel. Every push to the `main` branch of this repository redeploys it.
Vercel cannot run Streamlit, so the Vercel site is a plain web page backed by the FastAPI functions in `api/`.
The Streamlit version (`app.py`) can still be hosted on Streamlit Community Cloud by choosing `app.py` as the entry point.

## Note

The 20-city Nigerian backbone is hypothetical. It does not describe any operator's real network.
Timing results (E5, and the millisecond figures shown on the website) vary slightly between computers;
every other number is fixed by random seeds.
