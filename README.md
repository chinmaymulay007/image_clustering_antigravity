# Image Clustering Antigravity

This project is a browser-based application for clustering images using local AI models. It offers two processing pipelines:
1.  **Dense Captioning (Gemma + USE)**: Generates descriptive captions and embeds them using Universal Sentence Encoder.
2.  **Direct Image Embedding (CLIP)**: Uses OpenAI's CLIP models to generate embeddings directly from images (faster and multi-modal).

## Features
- **Step 1: Generation**: Analyzes images to generate captions (optional) and visual/semantic embeddings.
- **Step 2: Clustering**: Groups similar images based on semantic meaning using algorithms like DBSCAN, K-Means, etc.
- **Step 3: Organization**: Physically organizes files into folders based on clusters.
- **Privacy First**: All processing happens locally in your browser. No images are uploaded.

## Setup & Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/chinmaymulay007/image_clustering_antigravity.git
    cd image_clustering_antigravity
    ```

2.  **Download Model Files**:
    This project requires local AI models. You must download them manually:
    
    ### For Dense Captioning (Gemma):
    - **Download**: `gemma-3n-E2B-it-int4-Web.litertlm`
        - [Download Link](https://huggingface.co/google/gemma-3n-E2B-it-litert-lm/blob/main/gemma-3n-E2B-it-int4-Web.litertlm)
    - **Place the file** in the project root directory.

    ### For Direct Image Embedding (CLIP):
    - **Directory**: Create a folder `models/` in the project root. (If not already present)
    - **Recommended Model**: `clip-vit-base-patch16`
        - [Download ONNX Files](https://huggingface.co/Xenova/clip-vit-base-patch16/tree/main/onnx)
        - Download file `vision_model_quantized.onnx` and place it like below.
    - **Structure**:
      ```text
      /project-root
        /models
          /clip-vit-base-patch16
            /onnx
              vision_model_quantized.onnx
            config.json
            preprocessor_config.json
            ...
      ```

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

