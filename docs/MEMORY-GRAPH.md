# Memory Graph (Knowledge Graph Viewer)

An interactive 3D graph of everything your agents have written down — docs, daily
notes, distilled memories and wiki pages — laid out as a galaxy you can fly
through.

> This implements the **Knowledge Graph Viewer** item from
> [ROADMAP.md](../ROADMAP.md) (previously listed under *🔭 Longer-term*).

---

## What it shows

| | |
|---|---|
| **Nodes** | Every memory file: `doc` (SOUL.md, MEMORY.md…), `daily`, `deep`, `light`, `rem`, `wiki` |
| **Edges — `timeline`** | Consecutive daily notes of the same agent, so a running log reads as a thread |
| **Edges — `evidence`** | A note that cites, links to, or echoes a shared doc/wiki page |
| **Agents** | Each agent gets its own colour and orbital band |

Click any node to read its title, date, agent, path and a text excerpt, then
**load the full text** straight from the workspace.

---

## How it works

```
~/.openclaw/workspace/**  ──scan──▶  nodes + edges  ──▶  public/memory-graph-data.json
                                                              │
                        src/lib/memory-graph/graph-server.ts ─┘
                                    │  (incremental rebuild + SWR)
                                    ▼
                        GET /api/memory-graph/data  ──▶  /memory-graph (three.js)
```

1. **Scan** — `scripts/build-memory-graph.mjs` walks the OpenClaw workspace and the
   wiki root, turning each markdown file into a node (title from the first heading,
   date from the filename, snippet from the body).
2. **Build** — the same script collapses the scan into `{ nodes, edges, agents, stats }`.
3. **Serve** — `src/lib/memory-graph/graph-server.ts` keeps a running snapshot and
   serves it over `/api/memory-graph/data`. It is **incremental**: each agent domain
   is hashed, and only domains whose signature changed are re-scanned. Stale
   snapshots are returned immediately while a rebuild runs in the background
   (stale-while-revalidate), and writes are atomic (`*.tmp` + rename, with an
   `EPERM` retry loop that is friendly to Windows file locking).
4. **Render** — `src/app/(dashboard)/memory-graph/page.tsx` draws it with
   hand-rolled **three.js** (custom canvas textures, glow sprites, orbit rings,
   label sprites, additive-blended edges). No iframe, no third-party graph library.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/memory-graph/data` | The full graph snapshot (nodes, edges, agents, stats) |
| `GET /api/memory-graph/files?path=…` | Read the full text of one node (path-guarded to the workspace) |

> An earlier standalone build of the viewer (a self-contained HTML page plus a
> vendored copy of three.js) used to live here. It was unused — the React page
> never embedded it — so it was removed to keep the repo lean. `three` is a normal
> dependency; nothing loads the viewer outside the Next.js app.

---

## Running it

### With OpenClaw

Nothing to do — open **Memory Map** in the sidebar. The first request builds the
snapshot (a few seconds), every later request is served from the incremental cache.

To build it once by hand:

```bash
npm run graph:build      # writes public/memory-graph-data.json
```

### Without OpenClaw

A fresh clone has no workspace to scan, so the API falls back to a **synthetic
dataset** (`public/memory-graph-demo.json`) and the page still renders — useful for
previewing the UI.

Regenerate the demo at any time:

```bash
node scripts/make-demo-graph.mjs
```

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OPENCLAW_DIR` | `~/.openclaw` | OpenClaw home |
| `OPENCLAW_WORKSPACE` | `$OPENCLAW_DIR/workspace` | Root that gets scanned |

Wiki pages are read from `$OPENCLAW_WORKSPACE/../wiki/main` when present.

---

## Privacy — read this before committing

`public/memory-graph-data.json` is a **runtime artifact**, not source. It contains
your real agent names, note titles and text excerpts, because that is exactly what
it visualises.

It is **git-ignored on purpose**. Do not commit it, and do not paste it into an
issue. The committed `public/memory-graph-demo.json` is 100% synthetic.

---

## Files

| Path | Role |
|---|---|
| `src/app/(dashboard)/memory-graph/page.tsx` | The 3D viewer |
| `src/lib/memory-graph/graph-server.ts` | Snapshot cache, signatures, incremental rebuild, atomic writes |
| `scripts/build-memory-graph.mjs` | Scanner + graph builder (single source of truth) |
| `scripts/make-demo-graph.mjs` | Synthetic demo dataset generator |
| `src/app/api/memory-graph/` | `data` and `files` routes |
| `public/memory-graph-demo.json` | Committed synthetic fallback |
| `public/memory-graph-data.json` | **git-ignored** runtime artifact (your real data) |
| `.memory-graph-state.json` | **git-ignored** incremental build state |
