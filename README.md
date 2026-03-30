# ClusterAI

A high-performance, browser-based application for semantic image clustering using local AI models. Select any folder from your device, and it will automatically group images by visual and semantic themes — without ever uploading data to the cloud.

**Live Demo**: Deployed on [Vercel](https://vercel.com) with full cross-browser support.

---

## 🚀 Key Features

### Core AI Engine
- **Local CLIP Embedding**: Uses OpenAI's CLIP (MobileCLIP S0 via Xenova) quantized for the browser to extract semantic vectors from images.
- **Deferred AI Worker**: The AI model initializes on-demand to minimize page load time.
- **Two Clustering Modes**: The app provides two complementary views of your images:
  - **🎨 Visual Clusters** — Groups images by semantic/visual similarity using K-Means++ on CLIP embeddings.
  - **📅 Timeline Clusters** — Groups images by date (and optionally location). Labels include the date and reverse-geocoded place name.
- **Clustering Stability (Centroid Anchors)**: Clusters are mathematically anchored to their centers. Even as new images arrive or $K$ changes, "Box 1" stays "Box 1," preventing the UI from jumping.
- **Warm Start Identity**: Uses a "Partial Warm Start" algorithm to preserve cluster identities when adding or removing clusters.
- **Deterministic Numbering**: Cluster numbers are tied to their UI slots. If a locked cluster must move due to $K$-reduction, it shows a relocation badge (e.g., `7 ➔ 1`).
- **Recalibrate (Cold Start)**: A dedicated ↺ button next to the "Visual Clusters" heading forces a fresh cold start — discards warm-start memory and re-seeds centroids from scratch, while still respecting any locked clusters.
- **Smart Deduplication**: Adjust the "Uniqueness Threshold" to ensure cluster previews show diverse images rather than near-duplicates.

### Cluster Management
- **Freeze / Lock Clusters**: Lock up to 6 clusters for structured export or Passfaces setup. Only clusters with 16+ images can be locked.
- **Drag-and-Drop Reordering**: Reorder locked clusters via an intuitive drag-and-drop modal before uploading or downloading.
- **Excluded Images (Trash)**: Easily remove images from clusters. View and restore them at any time via the Trash icon.
- **Stable Identity Ordering**: Size-based auto-sorting is disabled to ensure your clusters don't swap positions while you are looking at them.

### Export & Integration
- **📦 Download as ZIP**: Save selected clusters as a structured ZIP archive using [JSZip](https://stuk.github.io/jszip/) — works across all browsers.
- **🌍 Upload to Passfaces**: Directly upload 6 locked clusters (16 images each) to the [Passfaces](https://passfaces.vercel.app) platform via API. Includes automatic image compression to meet upload size requirements.

### Cross-Browser Compatibility
- **Universal File Input**: Uses the standard `<input type="file" webkitdirectory>` for folder selection, replacing the older File System Access API. Works on Chrome, Firefox, Edge, Safari, and mobile browsers.
- **IndexedDB Persistence**: All embeddings and project metadata are stored in the browser's IndexedDB — no server-side database required.

### Mobile & Background Processing
- **Screen Wake Lock**: Uses the [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) (`wake_lock.js`) to prevent the screen from dimming during active processing — keeping the device awake without needing to touch it.
- **Background Keep-Alive**: A silent, looping audio element (`background_keep_alive.js`) prevents mobile browsers from throttling or suspending JavaScript when the tab is backgrounded or the device display is locked by the OS, allowing long sessions to continue uninterrupted.
- **Responsive Mobile Header**: CSS Grid-based header layout places the branding, action buttons, and AI Engine Status Pill in distinct rows on narrow screens, preventing overlaps.

### UI & Experience
- **AI Engine Status Pill**: A premium header indicator showing real-time progress. Includes a persistent completion state, animated pause/resume icon, and animated fading progress bar.
- **Contextual Tips**: A rotating suggestions box offers helpful tips during processing; automatically hides when analysis is complete.
- **Storage Management**: View, inspect, and delete per-project AI metadata directly from the app — accessible from the landing page or Settings → Storage.
- **Premium UX Layout**: Dynamic padding adjustment for a centered look across all screen sizes, with breathable space for dense image grids.

---

## 🛠️ Processing Pipeline

1.  **Step 1: Scan & Embed** — Scans your selected folder for images (including subfolders), generates CLIP embedding vectors, and extracts EXIF metadata (date taken, GPS coordinates). Previously computed embeddings are loaded from IndexedDB for instant resume.
2.  **Step 2: Dual Cluster Update** — Every *N* images (configurable batch size: 20, 40, or 100):
    - **Visual Clusters** are refreshed via K-Means++ with warm-start stability and centroid anchoring.
    - **Timeline Clusters** are regenerated by grouping images by date, with reverse geocoding to label locations.
3.  **Step 3: Organize & Export** — Freeze/lock your best clusters, reorder them, then upload to Passfaces or download as a ZIP archive.

---

## ⚙️ Settings

| Setting | Description | Default |
|---|---|---|
| **Auto-Cluster Trigger (Batch Size)** | How many new images trigger a clustering refresh | 20 |
| **Number of Clusters (K)** | How many broad categories to find (2–20) | 6 |
| **Uniqueness Threshold** | Controls how different two images must be to both appear in the cluster preview grid (0–0.5) | 0.15 |

---

## 📦 Data & Persistence

All data is stored **locally in the browser** using IndexedDB — nothing is sent to any server during processing.

| Store | Contents |
|---|---|
| `projects` | Per-project manifest: project name, session info, excluded image paths, last update timestamp |
| `embeddings` | Cached CLIP embedding vectors, keyed by `project\|path` for instant resume across sessions |

The **Manage Local AI Storage** panel (accessible from the landing page or Settings → Storage) lets you:
- View all stored projects and their embedding counts
- Delete individual project data
- Wipe all AI metadata at once

---

## 🏗️ Architecture

```
index.html                  → Landing page, modals, and main UI shell
css/style.css               → Full application stylesheet
js/
  app.js                    → Main application controller & orchestrator
  ui_manager.js             → DOM manipulation, modals, event binding
  clustering_engine.js      → K-Means++ with cosine distance & warm start
  clustering_worker.js      → Web Worker wrapper for off-thread clustering
  processing_manager.js     → Image scanning, embedding pipeline, batch logic
  file_system.js            → Universal file input handler (File objects)
  db_manager.js             → IndexedDB persistence layer
  ai_worker.js              → CLIP model inference Web Worker
  image_worker.js           → Image preprocessing helper
  wake_lock.js              → Screen Wake Lock API manager
  background_keep_alive.js  → Silent audio loop for background tab keep-alive
  vendor/                   → Third-party ONNX runtime files
models/                     → Quantized CLIP ONNX model files
clustering_algorithm.md     → Deep-dive into the clustering math
vercel.json                 → Deployment headers (COOP/COEP for SharedArrayBuffer)
```

---

## Setup & Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/chinmaymulay007/image_clustering_antigravity.git
    cd image_clustering_antigravity
    ```

2.  **Run the Application**:
    Use any static HTTP server (Python, Node, or VS Code Live Server):
    ```bash
    npx http-server .
    ```
    Open your browser to `http://localhost:8080`.

> **Note**: The app requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: same-origin` headers for SharedArrayBuffer support (needed by the ONNX runtime). The included `vercel.json` handles this for Vercel deployments. For local development, `http-server` works without additional configuration.

---

## 📋 Recent Changes

### v3 — Stability, Recalibration & Mobile
- ✅ Added **Recalibrate button** (↺) next to Visual Clusters heading for forced cold-start re-clustering
- ✅ Implemented **Screen Wake Lock** (`wake_lock.js`) to keep device screen on during processing
- ✅ Implemented **Background Keep-Alive** (`background_keep_alive.js`) using a silent audio loop to prevent mobile browser suspension when tab is backgrounded or device is OS-locked
- ✅ Refactored **mobile header** to CSS Grid layout — branding, actions, and AI pill placed in distinct rows to prevent overlap
- ✅ AI pill fading logic: pill now fades gracefully when analysis completes; tips section hides automatically
- ✅ **Centroid Anchoring**: Locked cluster centroids are mathematically frozen during `refreshClusters()` — warm-start centroids are overwritten with locked anchor positions before each K-Means pass
- ✅ **Cluster identity relocation badge**: locked clusters displaced by K-reduction display a `N ➔ M` badge
- ✅ Restored full 9-point instructions list in the Instructions modal; modal uses two-column layout on desktop
- ✅ Switched AI model to **MobileCLIP S0** (`Xenova/mobileclip_s0`) for faster inference

### v2 — Cross-Browser & Export
- ✅ Replaced File System Access API with **universal `<input>` file picker** for full cross-browser support
- ✅ Replaced local folder saving with **JSZip-based ZIP download**
- ✅ Added **Passfaces API upload** with image compression and retry logic
- ✅ Migrated metadata storage from filesystem to **IndexedDB**
- ✅ Added **cluster freeze/lock** mechanism (up to 6 clusters × 16 images)
- ✅ Added **drag-and-drop cluster reordering** modal
- ✅ New **AI Engine Status Pill** with live speed/ETA metrics and pause/resume
- ✅ Added **contextual suggestions/tips box** during processing
- ✅ Added **Storage Management UI** for viewing/deleting per-project AI data
- ✅ Implemented **deferred AI worker loading** for faster initial page loads
- ✅ Optimized for **mobile browsers** with responsive layout
- ✅ Deployed on **Vercel** with proper COOP/COEP headers

---

*Built with ❤️ for privacy-first AI.*