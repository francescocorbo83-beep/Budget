// Google Drive API Integration
const CLIENT_ID = '642665881666-bf2goer6t91ot88bcv26uimm4atjr3dp.apps.googleusercontent.com';
const API_KEY = 'AIzaSyDzlAur8-gZ9O535To39vWJjIy5lnq2MBs';

const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let tokenClient;
let gapiInited = false;
let gisInited = false;
let fileId = null;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-login').addEventListener('click', handleAuthClick);
    document.getElementById('btn-logout').addEventListener('click', handleSignoutClick);
    document.getElementById('btn-force-sync').addEventListener('click', forceSync);
});

// Load the Google API Client Library
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: DISCOVERY_DOCS,
        });
        gapiInited = true;
        maybeEnableButtons();
    } catch (err) {
        console.error('Error initializing GAPI client', err);
    }
}

// Load the Google Identity Services Client
function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '', // defined later
    });
    gisInited = true;
    maybeEnableButtons();
}

function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        // Ready
        console.log("Google APIs Ready");
    }
}

// Ensure scripts from index.html are loaded and trigger our functions
window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;

function handleAuthClick() {
    if(CLIENT_ID.includes('INSERISCI_QUI')) {
        alert("Configurazione mancante: Devi inserire il CLIENT_ID nel file js/gdrive.js");
        return;
    }
    
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        updateUIForLogin(true);
        await findOrCreateConfigFile();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        updateUIForLogin(false);
        setSyncStatus('Scollegato', '');
        fileId = null;
    }
}

function updateUIForLogin(isLoggedIn) {
    if (isLoggedIn) {
        document.getElementById('btn-login').classList.add('hidden');
        document.getElementById('user-info').classList.remove('hidden');
        setSyncStatus('Connesso', 'synced');
        // We could fetch user profile here if scope profile is added, skipping for simplicity
        document.getElementById('user-name').textContent = "Utente Drive";
    } else {
        document.getElementById('btn-login').classList.remove('hidden');
        document.getElementById('user-info').classList.add('hidden');
    }
}

function setSyncStatus(text, className) {
    const el = document.querySelector('.sync-status');
    const txtEl = document.getElementById('sync-text');
    
    el.className = 'sync-status ' + className;
    txtEl.textContent = text;
}

// Drive Operations
async function findOrCreateConfigFile() {
    setSyncStatus('Sincronizzazione...', 'syncing');
    try {
        const response = await gapi.client.request({
            path: '/drive/v3/files',
            method: 'GET',
            params: {
                q: "name='budget_data.json' and trashed=false",
                fields: 'files(id, name)',
                spaces: 'drive'
            }
        });

        const files = response.result.files;
        if (files && files.length > 0) {
            fileId = files[0].id;
            await downloadData();
        } else {
            // Create empty file
            await createConfigFile();
        }
    } catch (err) {
        console.error("Error finding file", err);
        setSyncStatus('Errore List', 'error');
    }
}

async function createConfigFile() {
    const metadata = {
        name: 'budget_data.json',
        mimeType: 'application/json'
    };
    
    try {
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        const localData = localStorage.getItem('nexbudget_data') || '{"categories":[],"transactions":[]}';
        form.append('file', new Blob([localData], { type: 'application/json' }));
        
        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: new Headers({ 'Authorization': 'Bearer ' + gapi.client.getToken().access_token }),
            body: form
        });
        
        const data = await response.json();
        if(data.error) throw data.error;
        
        fileId = data.id;
        setSyncStatus('Sincronizzato', 'synced');
    } catch(e) {
        console.error(e);
        setSyncStatus('Errore di creazione', 'error');
    }
}

async function downloadData() {
    try {
        // Tentativo con Fetch (più pulito per i JSON)
        const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        const res = await fetch(url, {
            headers: new Headers({ 'Authorization': 'Bearer ' + gapi.client.getToken().access_token })
        });
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        
        const textData = await res.text();
        processDownloadedData(textData);
        
    } catch (err) {
        console.error("Fetch fallita, tento GAPI...", err);
        
        try {
            // Tentativo di emergenza con GAPI
            const response = await gapi.client.request({
                path: `/drive/v3/files/${fileId}`,
                method: 'GET',
                params: { alt: 'media' }
            });
            processDownloadedData(response.body || response.result);
            
        } catch (err2) {
            if (err2 && err2.status === 200 && err2.body) {
                processDownloadedData(err2.body);
                return;
            }
            console.error("GAPI fallita:", err2);
            // Mostriamo l'errore esatto nell'icona in alto a destra!
            let msg = err.message || 'CORS';
            if(err2.status) msg = `API ${err2.status}`;
            setSyncStatus(`Errore: ${msg}`, 'error');
        }
    }
}

function processDownloadedData(rawData) {
    let cloudData = null;
    if (typeof rawData === 'string') {
        try { cloudData = JSON.parse(rawData || '{}'); } catch(e){}
    } else if (rawData) {
        cloudData = rawData;
    }
    
    if (window.updateStateFromCloud && cloudData) {
        window.updateStateFromCloud(cloudData);
    }
    setSyncStatus('Sincronizzato', 'synced');
}

// Expose to app.js to trigger on save
window.gdriveSyncData = async function(stateData) {
    if (!fileId || !gapi.client.getToken()) return;
    
    setSyncStatus('Salvataggio...', 'syncing');
    try {
        await gapi.client.request({
            path: `/upload/drive/v3/files/${fileId}`,
            method: 'PATCH',
            params: { uploadType: 'media' },
            body: JSON.stringify(stateData)
        });
        setSyncStatus('Sincronizzato', 'synced');
    } catch (e) {
        console.error("Error syncing file", e);
        setSyncStatus('Errore sync', 'error');
    }
};

function forceSync() {
    if(fileId) {
        downloadData();
    } else {
        alert("Non connesso a Google Drive. Effettua prima l'accesso.");
    }
}

// Update index.html script tags onload mapping
window.onload = function() {
    // This is a workaround since index.html has async defer tags without onload callback query params
    // Let's manually trigger loading
    if(window.gapi) {
        gapiLoaded();
    } else {
        setTimeout(()=> { if(window.gapi) gapiLoaded(); }, 1000);
    }
    
    if(window.google && window.google.accounts) {
        gisLoaded();
    } else {
        setTimeout(()=> { if(window.google && window.google.accounts) gisLoaded(); }, 1000);
    }
}
