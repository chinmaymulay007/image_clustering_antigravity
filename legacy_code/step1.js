// Copyright 2024 The MediaPipe Authors.

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//      http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// ---------------------------------------------------------------------------------------- //

import {FilesetResolver, LlmInference} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';
import {TextEmbedder} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text';

// const prompt = 'Describe primary subject and primary theme of the image in short sentence';
// const prompt = 'Describe only clearly visible main subject and/or theme in simple, factual and concise sentence using consistent wording and no adjectives, guesses, or synonyms.';
const prompt = 'Describe this image in a short sentence of 8-10 words';
// const prompt = 'Describe this image';
const output = document.getElementById('output');
const submit = document.getElementById('submit');
const imageDirectory = '/images-collection';
const metadataDirectory = `${imageDirectory}/metadata`;
const modelFileName = 'gemma-3n-E2B-it-int4-Web.litertlm';
const embedderFileName = 'universal_sentence_encoder.tflite';
let textEmbedder;

async function createEmbedder() {
  const textFiles = await FilesetResolver.forTextTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@latest/wasm");
  textEmbedder = await TextEmbedder.createFromOptions(
    textFiles,
    {
      baseOptions: {
        modelAssetPath: embedderFileName
      }//,
      //quantize: true
    }
  );
}

/**
 * Main function to run LLM Inference.
 */
async function runDemo() {
  const genaiFileset = await FilesetResolver.forGenAiTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm');
  let llmInference;

  const filenames = await parseDirectoryListing(imageDirectory);
  let filenamesArray = [];
  let captionsArray = [];
  let embeddingsArray = [];

  submit.onclick = async() => {

    document.getElementById('start_ts').innerHTML = `Started at ${getTimestamp()}<br>`;
    const startTS = new Date();
    submit.disabled = true;
    createEmbedder();
    console.log(`\nFound ${filenames.length} files. Starting caption and embedding generation...`);
    let index=0;
    for(const filename of filenames) {
      index+=1;
      console.log(`File ${index}: **${imageDirectory}/${filename}**`);
      const response = await llmInference.generateResponse([prompt,{imageSource: `${imageDirectory}/${filename}`}]);
      const embeddingResult = textEmbedder.embed(response);
      filenamesArray.push(filename);
      captionsArray.push(response);
      embeddingsArray.push(embeddingResult.embeddings[0]);
      var currentTS= new Date();
      var diffMs = Math.abs(currentTS - startTS);
      output.innerHTML += `${getTimestamp()} Processed Files: ${index} / ${filenames.length} | Elapsed time: ${(diffMs / (1000 * 60)).toPrecision(4)} min | Speed: ${((diffMs/index) / (1000)).toPrecision(4)} sec/image | Remaining time: ${((diffMs/index)*(filenames.length-index) / (1000 * 60)).toPrecision(4)} min<br>`;
    };
    console.log('Caption and embedding generation complete.');
    output.innerHTML += `<br> Ended at ${getTimestamp()}`;
    //output.innerHTML += `<br> Total ${index} images`;
    //console.log(filenamesArray);
    downloadJsonFile(filenamesArray,'filenamesArray.json');
    //localStorage.setItem('filenamesArray', JSON.stringify(filenamesArray));
    //console.log(captionsArray);
    downloadJsonFile(captionsArray,'captionsArray.json');
    //localStorage.setItem('captionsArray', JSON.stringify(captionsArray));
    //console.log(embeddingsArray);
    downloadJsonFile(embeddingsArray,'embeddingsArray.json');
    //localStorage.setItem('embeddingsArray', JSON.stringify(embeddingsArray));
    output.innerHTML += `<br>Metadata downloaded to downloads folder. Move it to ${metadataDirectory} folder.`;
  };

  submit.value = 'Loading the model...'
  LlmInference
      .createFromOptions(genaiFileset, {
        baseOptions: {modelAssetPath: modelFileName},
        // maxTokens: 512,  // The maximum number of tokens (input tokens + output
        //                  // tokens) the model handles.
        // randomSeed: 101,   // The random seed used during text generation.
        // topK: 1,  // The number of tokens the model considers at each step of
        //           // generation. Limits predictions to the top k most-probable
        //           // tokens. Setting randomSeed is required for this to make
        //           // effects.
        temperature:
            0,  // The amount of randomness introduced during generation.
                  // Setting randomSeed is required for this to make effects.
        maxNumImages: 1
      })
      .then(llm => {
        llmInference = llm;
        submit.disabled = false;
        submit.value = 'Start'
      })
      .catch((e) => {
        console.error(e);
        alert('Failed to initialize the task.');
      });
  
}

function getTimestamp() {
    const now = new Date();
    
    // Format the time as HH:MM:SS
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `[${hours}:${minutes}:${seconds}]`;
}

function downloadJsonFile(jsonData, filename) {
    const blob = new Blob([JSON.stringify(jsonData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename; // The suggested file name for the download
    document.body.appendChild(a);
    a.click(); // Programmatically triggers the download
    document.body.removeChild(a);
    URL.revokeObjectURL(url); // Clean up the object URL
}

async function parseDirectoryListing(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch directory listing: ${response.status}`);
    }
    const htmlText = await response.text();
    
    // Use DOMParser to treat the HTML string as a document
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    
    // **This selector is highly dependent on the server's HTML structure**
    // It often targets anchor tags (<a>) that link to files.
    const fileLinks = doc.querySelectorAll('a'); 
    
    const filenames = Array.from(fileLinks)
      .map(link => link.textContent) // Get the text (filename)
      .filter(name => name && name !== 'Parent Directory' && !name.endsWith('/')); // Basic filtering
      
    console.log('Extracted Filenames:', filenames);
    return filenames;
    
  } catch (error) {
    console.error('Error parsing directory listing:', error);
    return [];
  }
}

runDemo();