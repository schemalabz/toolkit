import { Command } from '@tauri-apps/plugin-shell';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';

// DOM elements
const form = document.getElementById('config-form') as HTMLFormElement;
const templatePathInput = document.getElementById('template-path') as HTMLInputElement;
const pickTemplateBtn = document.getElementById('pick-template') as HTMLButtonElement;
const qrModeRadios = document.querySelectorAll<HTMLInputElement>('input[name="qr-mode"]');
const markerFields = document.getElementById('marker-fields')!;
const manualFields = document.getElementById('manual-fields')!;
const markerColorInput = document.getElementById('marker-color') as HTMLInputElement;
const qrXInput = document.getElementById('qr-x') as HTMLInputElement;
const qrYInput = document.getElementById('qr-y') as HTMLInputElement;
const qrSizeInput = document.getElementById('qr-size') as HTMLInputElement;
const baseUrlInput = document.getElementById('base-url') as HTMLInputElement;
const campaignInput = document.getElementById('campaign') as HTMLInputElement;
const sourceInput = document.getElementById('source') as HTMLInputElement;
const a3CountInput = document.getElementById('a3-count') as HTMLInputElement;
const a4CountInput = document.getElementById('a4-count') as HTMLInputElement;
const startNumberInput = document.getElementById('start-number') as HTMLInputElement;
const prefixInput = document.getElementById('prefix') as HTMLInputElement;
const padDigitsInput = document.getElementById('pad-digits') as HTMLInputElement;
const outDirInput = document.getElementById('out-dir') as HTMLInputElement;
const pickOutdirBtn = document.getElementById('pick-outdir') as HTMLButtonElement;
const generateBtn = document.getElementById('btn-generate') as HTMLButtonElement;
const dryRunBtn = document.getElementById('btn-dryrun') as HTMLButtonElement;
const progressSection = document.getElementById('progress-section')!;
const progressBar = document.getElementById('progress-bar')!;
const progressText = document.getElementById('progress-text')!;
const logEl = document.getElementById('log')!;
const outputLinks = document.getElementById('output-links')!;
const outputFiles = document.getElementById('output-files')!;

// QR mode toggle
qrModeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    const isDetect = (document.querySelector('input[name="qr-mode"]:checked') as HTMLInputElement).value === 'detect';
    markerFields.classList.toggle('hidden', !isDetect);
    manualFields.classList.toggle('hidden', isDetect);
  });
});

// File pickers
pickTemplateBtn.addEventListener('click', async () => {
  const path = await openDialog({
    multiple: false,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
  });
  if (path) templatePathInput.value = path as string;
});

pickOutdirBtn.addEventListener('click', async () => {
  const path = await openDialog({ directory: true });
  if (path) outDirInput.value = path as string;
});

// Encode payload as base64 for sidecar argument
function toBase64(obj: unknown): string {
  return btoa(JSON.stringify(obj));
}

// Build config JSON from form
function buildConfig(dryRun: boolean) {
  const qrMode = (document.querySelector('input[name="qr-mode"]:checked') as HTMLInputElement).value;
  const a3 = parseInt(a3CountInput.value || '0', 10);
  const a4 = parseInt(a4CountInput.value || '0', 10);

  const batches: { paper: string; count: number }[] = [];
  if (a3 > 0) batches.push({ paper: 'A3', count: a3 });
  if (a4 > 0) batches.push({ paper: 'A4', count: a4 });

  const totalCount = batches.reduce((s, b) => s + b.count, 0);
  const start = parseInt(startNumberInput.value || '1', 10);
  const pad = parseInt(padDigitsInput.value || '0', 10) || String(start + totalCount - 1).length;

  return {
    templatePath: templatePathInput.value,
    baseUrl: baseUrlInput.value,
    campaign: campaignInput.value,
    source: sourceInput.value || 'qr',
    batches,
    start,
    prefix: prefixInput.value,
    padDigits: pad,
    outDir: outDirInput.value,
    dryRun,
    qrX: qrMode === 'manual' ? parseInt(qrXInput.value || '0', 10) : 0,
    qrY: qrMode === 'manual' ? parseInt(qrYInput.value || '0', 10) : 0,
    qrSize: qrMode === 'manual' ? parseInt(qrSizeInput.value || '0', 10) : 0,
    idCorner: 'bottom-left',
    idSize: 48,
    idColor: '#999999',
    idOffset: 150,
    _detect: qrMode === 'detect',
    _markerColor: markerColorInput.value || 'FF00FF',
  };
}

function validate(config: ReturnType<typeof buildConfig>): string | null {
  if (!config.templatePath) return 'Please select a template image.';
  if (!config.baseUrl) return 'Please enter a base URL.';
  try { new URL(config.baseUrl); } catch { return 'Invalid URL format.'; }
  const total = config.batches.reduce((s, b) => s + b.count, 0);
  if (total < 1) return 'Please set at least one A3 or A4 count.';
  if (!config.dryRun && !config.outDir) return 'Please select an output directory.';
  if (!config._detect && (!config.qrSize || config.qrSize < 1)) return 'Please enter QR size in manual mode.';
  return null;
}

function log(msg: string) {
  logEl.textContent += msg + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

// Run sidecar with base64 arg, collect full output
async function runSidecar(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cmd = Command.sidecar('binaries/poster-qr-sidecar', [toBase64(input)]);

  return new Promise((resolve) => {
    let output = '';
    cmd.stdout.on('data', (line: string) => {
      output += line + '\n';
    });
    cmd.stderr.on('data', (line: string) => {
      log(`stderr: ${line}`);
    });
    cmd.on('error', (err: string) => {
      log(`Sidecar error: ${err}`);
      resolve({ error: err });
    });
    cmd.on('close', (data: { code: number; signal: number | null }) => {
      if (data.code !== 0) {
        log(`Sidecar exited with code ${data.code}`);
      }
      try {
        const lines = output.trim().split('\n').filter(l => l.trim());
        const last = lines[lines.length - 1];
        resolve(JSON.parse(last));
      } catch {
        resolve({ error: output || 'No output from sidecar' });
      }
    });
    cmd.spawn().catch((err: Error) => {
      log(`Failed to spawn sidecar: ${err.message}`);
      resolve({ error: err.message });
    });
  });
}

// Run sidecar with streaming NDJSON progress
async function runSidecarStreaming(input: Record<string, unknown>) {
  const cmd = Command.sidecar('binaries/poster-qr-sidecar', [toBase64(input)]);

  return new Promise<void>((resolve, reject) => {
    cmd.stdout.on('data', (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line.trim());
        handleProgress(event);
      } catch {
        log(line);
      }
    });

    cmd.stderr.on('data', (line: string) => {
      log(`stderr: ${line}`);
    });

    cmd.on('error', (err: string) => {
      log(`Sidecar error: ${err}`);
      progressText.textContent = `Error: ${err}`;
      resolve();
    });

    cmd.on('close', (data: { code: number; signal: number | null }) => {
      if (data.code !== 0) {
        log(`Sidecar exited with code ${data.code}`);
      }
      resolve();
    });

    cmd.spawn().catch((err: Error) => {
      log(`Failed to spawn sidecar: ${err.message}`);
      progressText.textContent = `Failed to start: ${err.message}`;
      resolve();
    });
  });
}

function handleProgress(event: { type: string; [key: string]: unknown }) {
  switch (event.type) {
    case 'info':
      log(event.message as string);
      break;

    case 'batch-start':
      log(`\n--- ${event.paper} (${event.count} posters) ---`);
      break;

    case 'poster': {
      const pct = Math.round(((event.index as number) / (event.total as number)) * 100);
      progressBar.style.width = `${pct}%`;
      progressText.textContent = `${event.index}/${event.total} — poster-${event.id}`;
      log(`poster-${event.id}`);
      break;
    }

    case 'pdf-saved': {
      log(`Saved: ${event.path} (${event.sizeMb} MB)`);
      outputLinks.classList.remove('hidden');
      const div = document.createElement('div');
      div.className = 'output-file';
      const span = document.createElement('span');
      span.textContent = `${event.paper} — ${event.sizeMb} MB`;
      const btn = document.createElement('button');
      btn.textContent = 'Open';
      btn.addEventListener('click', () => openPath(event.path as string));
      div.appendChild(span);
      div.appendChild(btn);
      outputFiles.appendChild(div);
      break;
    }

    case 'done':
      progressBar.style.width = '100%';
      progressBar.classList.add('done');
      progressText.textContent = `Done! Generated ${event.totalCount} posters.`;
      log(`\nDone! Generated ${event.totalCount} posters.`);
      break;

    case 'dry-run-item':
      log(`${event.id} [${event.paper}] -> ${event.url}`);
      break;

    case 'dry-run-done':
      progressBar.style.width = '100%';
      progressBar.classList.add('done');
      progressText.textContent = `Dry run complete. ${event.totalCount} posters would be generated.`;
      break;

    case 'error':
      log(`ERROR: ${event.message}`);
      progressText.textContent = `Error: ${event.message}`;
      break;
  }
}

// Main flow
async function run(dryRun: boolean) {
  const config = buildConfig(dryRun);
  const error = validate(config);
  if (error) {
    alert(error);
    return;
  }

  // Reset UI
  progressSection.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressBar.classList.remove('done');
  progressText.textContent = 'Starting...';
  logEl.textContent = '';
  outputLinks.classList.add('hidden');
  outputFiles.innerHTML = '';
  generateBtn.disabled = true;
  dryRunBtn.disabled = true;

  try {
    // If auto-detect mode, run marker detection first
    if (config._detect && !dryRun) {
      log('Detecting marker...');
      const detectResult = await runSidecar({
        action: 'detect-marker',
        templatePath: config.templatePath,
        markerColor: config._markerColor,
      });

      if (detectResult.error) {
        log(`Error: ${detectResult.error}`);
        progressText.textContent = 'Failed';
        return;
      }

      config.qrX = detectResult.x as number;
      config.qrY = detectResult.y as number;
      config.qrSize = detectResult.size as number;
      log(`Marker found: (${detectResult.x}, ${detectResult.y}) ${detectResult.size}x${detectResult.size}px`);
    } else if (config._detect && dryRun) {
      config.qrX = 0;
      config.qrY = 0;
      config.qrSize = 100;
    }

    // Run generation
    await runSidecarStreaming({
      action: 'generate',
      config: {
        templatePath: config.templatePath,
        baseUrl: config.baseUrl,
        campaign: config.campaign,
        source: config.source,
        batches: config.batches,
        start: config.start,
        prefix: config.prefix,
        padDigits: config.padDigits,
        outDir: config.outDir,
        dryRun: config.dryRun,
        qrX: config.qrX,
        qrY: config.qrY,
        qrSize: config.qrSize,
        idCorner: config.idCorner,
        idSize: config.idSize,
        idColor: config.idColor,
        idOffset: config.idOffset,
      },
    });
  } finally {
    generateBtn.disabled = false;
    dryRunBtn.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  run(false);
});

dryRunBtn.addEventListener('click', () => {
  run(true);
});
