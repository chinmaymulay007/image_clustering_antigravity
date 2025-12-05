import clustering from 'https://cdn.jsdelivr.net/npm/density-clustering@1.3.0/+esm';
import {TextEmbedder} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text';

const prerequisites = document.getElementById('prerequisites');
const output = document.getElementById('output');
const submit = document.getElementById('submit');
const download = document.getElementById('download');
const downloadresponse = document.getElementById('downloadresponse');
const eps = document.getElementById('eps');
const minPts = document.getElementById('minPts');
const imageDirectory = '/images-collection';
const metadataDirectory = `${imageDirectory}/metadata`;
let filenamesArray = [];
let captionsArray = [];
let embeddingsArray = [];

async function runStep2() {
    //const filenames = await parseDirectoryListing(imageDirectory);
    try{
        await loadMetadata();
        prerequisites.innerHTML = `Loaded all metadata.`;
        submit.disabled = false;
        submit.value = 'Start'

    } catch (error) {
        console.error("Error loading JSON files:", error);
        prerequisites.innerHTML = `Metadata loading failed. Ensure metadata files are copied into ${metadataDirectory} folder!`;
    }
    submit.onclick = runClustering;
}

async function runClustering() {
    document.getElementById('start_ts').innerHTML = `Started at ${getTimestamp()}<br>`;
    submit.disabled = true;
    output.innerHTML=`Epsilon value is ${eps.value}, Minimum cluster size is ${minPts.value}<br>`;
    var distanceMatrix = embeddingsArray.map(e1 => embeddingsArray.map(e2 => cosineDistance(e1, e2)));
    const dbscan = new clustering.DBSCAN();
    const clusters = dbscan.run(distanceMatrix, eps.value, minPts.value);
    var orderedClusters = clusters.sort((a, b) => b.length - a.length);;

    output.innerHTML += `Ended at ${getTimestamp()}<br><hr>Select clusters from below`;
    var viewClusters = `<table><tr><th>Select</th><th>Cluster</th><th>Images</th><th>View Images</th></tr>`;
    orderedClusters.forEach((cluster,index) => {
      viewClusters += `<tr>
                        <td><input type="checkbox" class="clusters" id="cluster-${index}"></td>
                        <td>${index}</td>
                        <td>${cluster.length}</td>
                        <td><button type="button" class="collapsible">Expand/Collapse</button>
                            <div class="content"><p>`;
      cluster.forEach((item) => {
        viewClusters += `<img width="100px" height="auto" title="${captionsArray[item]}" src="${imageDirectory}/${filenamesArray[item]}" loading="lazy"> `
      });
      viewClusters += `</p></div></td></tr>`;
    });
    output.innerHTML += `</table>` + viewClusters;
    enableCollapsibles();

    submit.disabled = false;
    submit.value = 'Restart';

    download.disabled=false;
    download.hidden=false;
    download.onclick = async() => {
        var selectedClusters = [];
        var checkboxes = document.getElementsByClassName("clusters");
        for (var i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].type === "checkbox" && checkboxes[i].checked) {
                selectedClusters.push(orderedClusters[i]);
            }
        }
        if(selectedClusters.length<1 || selectedClusters.length>6) {
            downloadresponse.innerHTML = `Select min 1 to max 6 clusters`;
        } else {
            downloadZipFile(selectedClusters,filenamesArray);
            downloadJsonFile(selectedClusters,'clusters.json');
            downloadresponse.innerHTML = `Clusters zip and json metadata is being downloaded to downloads folder.`;
        }
    };
}

function cosineDistance(a,b){
  return 1 - TextEmbedder.cosineSimilarity(a,b)
}

function getTimestamp() {
    const now = new Date();
    
    // Format the time as HH:MM:SS
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `[${hours}:${minutes}:${seconds}]`;
}

async function downloadZipFile(clusters,filenames) {
    var zip = new JSZip();
    // Function to fetch file and add to zip
    const addFileToZip = async (url, filename) => {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Could not fetch file: ${url}`);
            const blob = await response.blob();
            // The key line: use the full path including folder names
            zip.file(filename, blob);
        } catch (error) {
            console.error(error);
        }
    };
    var zippedFiles = [];
    var i = 0;
    for(let cluster of clusters) {
        for(let image of cluster) {
            zippedFiles.push({ url: `${imageDirectory}/${filenamesArray[image]}`, path: `cluster-${i}/${filenamesArray[image]}` });
        }
        i++;
    }
    console.log(zippedFiles);
    await Promise.all(zippedFiles.map(file => addFileToZip(file.url, file.path)));
    zip.generateAsync({ type: 'blob' }).then(function(content) {
    saveAs(content, 'image_clusters.zip');
  })
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

async function loadMetadata() {
    const files = [
        `${metadataDirectory}/filenamesArray.json`,
        `${metadataDirectory}/captionsArray.json`,
        `${metadataDirectory}/embeddingsArray.json`
    ];

    // Fetch all files concurrently
    const responses = await Promise.all(files.map(url => fetch(url)));

    // Check for any non-ok responses immediately
    for (const response of responses) {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for file ${response.url}`);
        }
    }

    // Parse all responses into JSON objects concurrently
    const dataObjects = await Promise.all(responses.map(response => response.json()));

    // dataObjects is an array containing your three JSON objects in order    
    // You can access them by index:
    filenamesArray = dataObjects[0];
    captionsArray = dataObjects[1];
    embeddingsArray = dataObjects[2];

    console.log("All metadata files loaded");
    //console.log("filenamesArray",filenamesArray);
    //console.log("captionsArray",captionsArray);
    //console.log("embeddingsArray",embeddingsArray);

}

async function enableCollapsibles(){
    var coll = document.getElementsByClassName("collapsible");
    var i;

    for (i = 0; i < coll.length; i++) {
    coll[i].addEventListener("click", function() {
        this.classList.toggle("active");
        var content = this.nextElementSibling;
        if (content.style.display === "block") {
        content.style.display = "none";
        } else {
        content.style.display = "block";
        }
    });
}
}

runStep2()