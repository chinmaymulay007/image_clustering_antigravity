# Image Clustering Antigravity v2

A high-performance, browser-based application for semantic image clustering using local AI models. Point it at any folder on your computer, and it will automatically group images by visual and semantic themes without ever uploading data to the cloud.

## 🚀 Key Features

- **Local CLIP Embedding**: Uses OpenAI's CLIP (ViT-Base-Patch16) quantized for the browser to extract semantic vectors from images.
- **Dynamic Clustering**: Real-time K-Means clustering that evolves as images are processed.
- **Clustering Stability (Warm Start)**: Centers "remember" their positions during updates, preventing the UI from jumping around.
- **Smart Deduplication**: Adjust the "Uniqueness Threshold" to ensure cluster previews show diverse images rather than near-duplicates.
- **Selective Saving**: Choose specific clusters to save; the app will physically organize them into folders on your disk.
- **Excluded Images (Trash)**: Easily remove images from clusters. View and restore them at any time via the Trash icon.
- **Size-based Sorting**: Clusters are automatically ordered by the number of images they contain (largest first).
- **Project Isolation**: All metadata and saved outputs are prefixed with `clusterai_` to keep your original folders clean.

## 🛠️ Processing Pipeline

1.  **Step 1: Scan & Embed**: Recursively scans your selected folder for images and generates 512-dimensional semantic vectors.
2.  **Step 2: Dynamic Update**: Every 20 images (configurable), the system refreshes clusters using the latest data.
3.  **Step 3: Organize**: Filter, select, and save your curated clusters to disk.

## ⚙️ Settings

- **Number of Clusters (K)**: Define how many broad categories you want to find.
- **Update Frequency**: How often the UI refreshes (e.g., every 20 images).
- **Uniqueness Threshold**: Controls how different two images must be to both appear in the cluster preview grid.

## 📦 Data & Persistence

The application maintains a `clusterai_metadata` folder inside your image directory:
- **`embeddings.json`**: Cached semantic vectors for instant resume.
- **`manifest.json`**: Stores session info and excluded image paths.

## Setup & Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/chinmaymulay007/image_clustering_antigravity.git
    cd image_clustering_antigravity
    ```

2.  **Download Model Files**:
    Create a `models/` folder in the project root.
    - **CLIP Model**: Download `vision_model_quantized.onnx` from [Xenova/clip-vit-base-patch16](https://huggingface.co/Xenova/clip-vit-base-patch16/tree/main/onnx) and place it in `models/clip-vit-base-patch16/onnx/`.

3.  **Run the Application**:
    Use a simple HTTP server (Python, Node, or VS Code Live Server):
    ```bash
    npx http-server .
    ```
    Open your browser to `http://localhost:8080`.

---
*Built with ❤️ for privacy-first AI.*