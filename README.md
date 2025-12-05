# Image Clustering Antigravity

This project is a browser-based application for clustering images using local AI models. It uses Gemma for image captioning (via MediaPipe LLM Inference) and Universal Sentence Encoder for semantic clustering.

## Features
- **Step 1: Generation**: Analyzes images to generate captions and embeddings.
- **Step 2: Clustering**: Groups similar images based on semantic meaning.
- **Step 3: Organization**: Physically organizes files into folders based on clusters.
- **Privacy First**: All processing happens locally in your browser.

## Setup & Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/chinmaymulay007/image_clustering_antigravity.git
    cd image_clustering_antigravity
    ```

2.  **Download Model Files**:
    This project requires a large LLM file that is not included in the repository due to size limits.
    - **Download**: `gemma-3n-E2B-it-int4-Web.litertlm`
        - https://huggingface.co/google/gemma-3n-E2B-it
        - https://www.kaggle.com/models/google/gemma-3n
    - **Place the file** in the root directory of the project.
    - Ensure `universal_sentence_encoder.tflite` is also present (included in repo).

3.  **Run the Application**:
    - You need a simple HTTP server to run this due to browser security restrictions on local file access.
    - If you have Python installed:
        ```bash
        python -m http.server 8000
        ```
    - Or use Node.js `http-server`:
        ```bash
        npx http-server .
        ```
    - Open your browser to `http://localhost:8000`.

## Legacy Code
Older versions of the processing pipeline (`step1.html`, `step2.html`, etc.) have been moved to the `legacy_code/` directory. The main application entry point is `index.html`.
