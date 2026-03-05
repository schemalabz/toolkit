import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { appDataDir } from '@tauri-apps/api/path';
import { toBase64, log, runSidecarStreaming } from './main';

// DOM elements
const ytUrlInput = document.getElementById('yt-url') as HTMLInputElement;
const ytServerUrlInput = document.getElementById('yt-server-url') as HTMLInputElement;
const ytApiKeyInput = document.getElementById('yt-api-key') as HTMLInputElement;
const ytLocalOnlyCheckbox = document.getElementById('yt-local-only') as HTMLInputElement;
const ytOutDirInput = document.getElementById('yt-out-dir') as HTMLInputElement;
const ytPickOutdirBtn = document.getElementById('yt-pick-outdir') as HTMLButtonElement;
const ytDownloadBtn = document.getElementById('yt-download-btn') as HTMLButtonElement;
const ytProgressSection = document.getElementById('yt-progress-section')!;
const ytProgressBar = document.getElementById('yt-progress-bar')!;
const ytProgressText = document.getElementById('yt-progress-text')!;
const ytLogEl = document.getElementById('yt-log')!;
const ytResultSection = document.getElementById('yt-result-section')!;
const ytCdnUrlEl = document.getElementById('yt-cdn-url') as HTMLInputElement;
const ytCopyBtn = document.getElementById('yt-copy-btn') as HTMLButtonElement;
const ytServerFields = document.getElementById('yt-server-fields')!;
const ytServerSummary = document.getElementById('yt-server-summary')!;
const ytServerFieldset = document.getElementById('yt-server-fieldset')!;
const ytServerDetailEl = document.getElementById('yt-server-detail')!;
const ytServerEditBtn = document.getElementById('yt-server-edit') as HTMLButtonElement;
const ytDepsStatus = document.getElementById('yt-deps-status')!;
const ytDepsLabel = document.getElementById('yt-deps-label')!;
const ytDepsDetail = document.getElementById('yt-deps-detail')!;

// State
let ytdlpPath: string | null = null;
let depsReady = false;

// Persist server settings
const STORAGE_KEYS = {
  serverUrl: 'yt-server-url',
  apiKey: 'yt-api-key',
  localOnly: 'yt-local-only',
};

function loadSettings() {
  ytServerUrlInput.value = localStorage.getItem(STORAGE_KEYS.serverUrl) || '';
  ytApiKeyInput.value = localStorage.getItem(STORAGE_KEYS.apiKey) || '';
  const localOnly = localStorage.getItem(STORAGE_KEYS.localOnly);
  ytLocalOnlyCheckbox.checked = localOnly === 'true';
  updateServerFieldsVisibility();
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.serverUrl, ytServerUrlInput.value);
  localStorage.setItem(STORAGE_KEYS.apiKey, ytApiKeyInput.value);
  localStorage.setItem(STORAGE_KEYS.localOnly, String(ytLocalOnlyCheckbox.checked));
}

function hasServerSettings(): boolean {
  return !!(ytServerUrlInput.value.trim() && ytApiKeyInput.value.trim());
}

function updateServerFieldsVisibility() {
  ytServerFields.classList.toggle('hidden', ytLocalOnlyCheckbox.checked);
  if (ytLocalOnlyCheckbox.checked) return;

  // Collapse to summary if settings are already filled in
  const filled = hasServerSettings();
  const expanded = ytServerFieldset.classList.contains('expanded');
  ytServerSummary.classList.toggle('hidden', !filled || expanded);
  ytServerFieldset.classList.toggle('hidden', filled && !expanded);

  if (filled) {
    ytServerDetailEl.textContent = ytServerUrlInput.value.trim();
  }
}

function expandServerFields() {
  ytServerFieldset.classList.add('expanded');
  ytServerFieldset.classList.remove('hidden');
  ytServerSummary.classList.add('hidden');
}


function ytLog(msg: string) {
  log(ytLogEl, msg);
}

// --- Deps check ---

export async function ensureDeps() {
  ytDepsLabel.textContent = 'Checking dependencies...';
  ytDepsDetail.textContent = '';
  ytDepsStatus.classList.remove('hidden');
  ytDownloadBtn.disabled = true;

  try {
    const dataDir = await appDataDir();

    await runSidecarStreaming('binaries/yt-download-sidecar', {
      action: 'ensure-deps',
      dataDir,
    }, (event) => {
      if (event.type === 'deps-ready') {
        ytdlpPath = event.ytdlpPath as string;
        depsReady = true;
        ytDepsLabel.textContent = 'yt-dlp ready';
        ytDepsDetail.textContent = ytdlpPath;
        ytDepsStatus.classList.add('deps-ok');
        ytDownloadBtn.disabled = false;
      } else if (event.type === 'status') {
        ytDepsLabel.textContent = event.message as string;
      } else if (event.type === 'download-progress') {
        ytDepsLabel.textContent = `Downloading yt-dlp... ${event.percent}%`;
      } else if (event.type === 'error') {
        ytDepsLabel.textContent = `Error: ${event.message}`;
        ytDepsStatus.classList.add('deps-error');
      }
    }, ytLog, ytProgressText);
  } catch (err) {
    ytDepsLabel.textContent = `Failed to check dependencies: ${err}`;
    ytDepsStatus.classList.add('deps-error');
  }
}

// --- Progress handler ---

function handleProgress(event: { type: string; [key: string]: unknown }) {
  switch (event.type) {
    case 'status':
      ytLog(event.message as string);
      ytProgressText.textContent = event.message as string;
      break;

    case 'download-progress': {
      const pct = event.percent as number;
      ytProgressBar.style.width = `${pct}%`;
      ytProgressText.textContent = `Downloading... ${pct.toFixed(1)}% of ${event.total}`;
      break;
    }

    case 'upload-progress':
      if (event.status === 'uploading') {
        ytProgressText.textContent = 'Uploading to server...';
        ytLog('Uploading to server...');
      } else {
        ytProgressText.textContent = 'Upload complete';
        ytLog('Upload complete');
      }
      break;

    case 'complete': {
      const cdnUrl = event.cdnUrl as string;
      ytProgressBar.style.width = '100%';
      ytProgressBar.classList.add('done');
      ytProgressText.textContent = 'Done!';
      ytLog(`CDN URL: ${cdnUrl}`);
      ytResultSection.classList.remove('hidden');
      ytCdnUrlEl.value = cdnUrl;
      break;
    }

    case 'error':
      ytLog(`ERROR: ${event.message}`);
      ytProgressText.textContent = `Error: ${event.message}`;
      break;
  }
}

// --- Download ---

async function runDownload() {
  const youtubeUrl = ytUrlInput.value.trim();
  if (!youtubeUrl) {
    alert('Please enter a YouTube URL.');
    return;
  }

  const localOnly = ytLocalOnlyCheckbox.checked;
  if (!localOnly && (!ytServerUrlInput.value.trim() || !ytApiKeyInput.value.trim())) {
    alert('Server URL and API Key are required for upload. Use local-only mode to skip upload.');
    return;
  }

  const outputDir = ytOutDirInput.value.trim();
  if (!outputDir) {
    alert('Please select an output directory.');
    return;
  }

  saveSettings();

  // Reset UI
  ytProgressSection.classList.remove('hidden');
  ytProgressBar.style.width = '0%';
  ytProgressBar.classList.remove('done');
  ytProgressText.textContent = 'Starting...';
  ytLogEl.textContent = '';
  ytResultSection.classList.add('hidden');
  ytDownloadBtn.disabled = true;

  try {
    await runSidecarStreaming('binaries/yt-download-sidecar', {
      action: 'run',
      youtubeUrl,
      outputDir,
      localOnly,
      serverUrl: ytServerUrlInput.value.trim(),
      apiKey: ytApiKeyInput.value.trim(),
      ytdlpPath,
    }, handleProgress, ytLog, ytProgressText);
  } finally {
    ytDownloadBtn.disabled = false;
  }
}

// --- Event listeners ---

ytPickOutdirBtn.addEventListener('click', async () => {
  const path = await openDialog({ directory: true });
  if (path) ytOutDirInput.value = path as string;
});

ytDownloadBtn.addEventListener('click', runDownload);
ytLocalOnlyCheckbox.addEventListener('change', () => {
  ytServerFieldset.classList.remove('expanded');
  updateServerFieldsVisibility();
});
ytServerUrlInput.addEventListener('change', saveSettings);
ytApiKeyInput.addEventListener('change', saveSettings);
ytServerEditBtn.addEventListener('click', expandServerFields);

ytCopyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(ytCdnUrlEl.value);
  ytCopyBtn.textContent = 'Copied!';
  setTimeout(() => { ytCopyBtn.textContent = 'Copy'; }, 2000);
});

// Load saved settings
loadSettings();
