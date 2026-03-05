import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { runSidecar, runSidecarStreaming, wireDirectoryPicker } from './main';
import { ProgressPanel } from './progress-panel';

// Tool container
const toolEl = document.getElementById('tool-poster-qr')!;

// DOM elements
const templatePathInput = document.getElementById('template-path') as HTMLInputElement;
const pickTemplateBtn = document.getElementById('pick-template') as HTMLButtonElement;
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
const outDirInput = document.getElementById('pq-out-dir') as HTMLInputElement;
const pickOutdirBtn = document.getElementById('pq-pick-outdir') as HTMLButtonElement;
const generateBtn = document.getElementById('btn-generate') as HTMLButtonElement;
const dryRunBtn = document.getElementById('btn-dryrun') as HTMLButtonElement;
const outputLinks = document.getElementById('pq-output-links')!;
const outputFiles = document.getElementById('pq-output-files')!;
const previewImg = document.getElementById('preview-img') as HTMLImageElement;
const previewLoading = document.getElementById('preview-loading')!;
const detectStatus = document.getElementById('detect-status')!;
const redetectBtn = document.getElementById('btn-redetect') as HTMLButtonElement;

const progress = new ProgressPanel(toolEl);

// Wizard state
let currentStep = 1;
const totalSteps = 4;

const wizardStepEls = document.querySelectorAll<HTMLElement>('.wizard-step');
const wizardPanelEls = document.querySelectorAll<HTMLElement>('.wizard-panel');

// --- Wizard Navigation ---

function goToStep(step: number) {
  if (step < 1 || step > totalSteps) return;
  currentStep = step;

  wizardStepEls.forEach(el => {
    const s = parseInt(el.dataset.step!, 10);
    el.classList.toggle('active', s === step);
    el.classList.toggle('completed', s < step);
  });

  wizardPanelEls.forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.step!, 10) === step);
  });

  if (step === 2) {
    onEnterStep2();
  }
}

// --- Step 1: Template ---

pickTemplateBtn.addEventListener('click', async () => {
  const path = await openDialog({
    multiple: false,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
  });
  if (path) {
    templatePathInput.value = path as string;
    updateNextButton1();
  }
});

function updateNextButton1() {
  const btn = document.getElementById('btn-next-1') as HTMLButtonElement;
  btn.disabled = !templatePathInput.value;
}

document.getElementById('btn-next-1')!.addEventListener('click', () => goToStep(2));

// --- Step 2: QR Placement ---

async function onEnterStep2() {
  await runPreview(true);
}

let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPreviewUpdate() {
  if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(() => {
    runPreview(false);
  }, 300);
}

qrXInput.addEventListener('input', debouncedPreviewUpdate);
qrYInput.addEventListener('input', debouncedPreviewUpdate);
qrSizeInput.addEventListener('input', debouncedPreviewUpdate);

redetectBtn.addEventListener('click', () => runPreview(true));

async function runPreview(detect: boolean) {
  const hasImage = previewImg.style.display !== 'none' && previewImg.src;
  if (!hasImage) {
    previewLoading.classList.remove('hidden');
  }
  detectStatus.textContent = detect ? 'Detecting marker...' : 'Updating preview...';

  const input: Record<string, unknown> = {
    action: 'preview',
    templatePath: templatePathInput.value,
    markerColor: markerColorInput.value || 'FF00FF',
  };

  if (detect) {
    input.detect = true;
  } else {
    const x = parseInt(qrXInput.value || '0', 10);
    const y = parseInt(qrYInput.value || '0', 10);
    const size = parseInt(qrSizeInput.value || '0', 10);
    if (size > 0) {
      input.qrX = x;
      input.qrY = y;
      input.qrSize = size;
    }
  }

  const result = await runSidecar('binaries/poster-qr-sidecar', input);
  previewLoading.classList.add('hidden');

  if (result.error) {
    detectStatus.textContent = `Error: ${result.error}`;
    previewImg.style.display = 'none';
    return;
  }

  if (result.imageBase64) {
    previewImg.src = `data:image/png;base64,${result.imageBase64}`;
    previewImg.style.display = 'block';
  }

  if (detect && result.detected) {
    qrXInput.value = String(result.qrX);
    qrYInput.value = String(result.qrY);
    qrSizeInput.value = String(result.qrSize);
    detectStatus.textContent = `Detected at (${result.qrX}, ${result.qrY}) — ${result.qrSize}px`;
  } else if (!detect) {
    detectStatus.textContent = `Preview at (${qrXInput.value}, ${qrYInput.value}) — ${qrSizeInput.value}px`;
  }
}

document.getElementById('btn-back-2')!.addEventListener('click', () => goToStep(1));
document.getElementById('btn-next-2')!.addEventListener('click', () => goToStep(3));

// --- Step 3: Settings ---

document.getElementById('btn-back-3')!.addEventListener('click', () => goToStep(2));
document.getElementById('btn-next-3')!.addEventListener('click', () => goToStep(4));

// --- Step 4: Generate ---

wireDirectoryPicker(pickOutdirBtn, outDirInput);

document.getElementById('btn-back-4')!.addEventListener('click', () => goToStep(3));

generateBtn.addEventListener('click', () => run(false));
dryRunBtn.addEventListener('click', () => run(true));

// --- Progress handler ---

function handleProgress(event: { type: string; [key: string]: unknown }) {
  switch (event.type) {
    case 'info':
      progress.log(event.message as string);
      break;

    case 'batch-start':
      progress.log(`\n--- ${event.paper} (${event.count} posters) ---`);
      break;

    case 'poster': {
      const pct = Math.round(((event.index as number) / (event.total as number)) * 100);
      progress.setProgress(pct);
      progress.setText(`${event.index}/${event.total} — poster-${event.id}`);
      progress.log(`poster-${event.id}`);
      break;
    }

    case 'pdf-saved': {
      progress.log(`Saved: ${event.path} (${event.sizeMb} MB)`);
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
      progress.complete(`Done! Generated ${event.totalCount} posters.`);
      progress.log(`\nDone! Generated ${event.totalCount} posters.`);
      break;

    case 'dry-run-item':
      progress.log(`${event.id} [${event.paper}] -> ${event.url}`);
      break;

    case 'dry-run-done':
      progress.complete(`Dry run complete. ${event.totalCount} posters would be generated.`);
      break;

    case 'error':
      progress.log(`ERROR: ${event.message}`);
      progress.setError(event.message as string);
      break;
  }
}

// --- Main Generate ---

function buildConfig(dryRun: boolean) {
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
    qrX: parseInt(qrXInput.value || '0', 10),
    qrY: parseInt(qrYInput.value || '0', 10),
    qrSize: parseInt(qrSizeInput.value || '0', 10),
    idCorner: 'bottom-left',
    idSize: 48,
    idColor: '#999999',
    idOffset: 150,
  };
}

function validate(config: ReturnType<typeof buildConfig>): string | null {
  if (!config.templatePath) return 'Please select a template image.';
  if (!config.baseUrl) return 'Please enter a base URL.';
  try { new URL(config.baseUrl); } catch { return 'Invalid URL format.'; }
  const total = config.batches.reduce((s, b) => s + b.count, 0);
  if (total < 1) return 'Please set at least one A3 or A4 count.';
  if (!config.dryRun && !config.outDir) return 'Please select an output directory.';
  if (!config.qrSize || config.qrSize < 1) return 'QR size must be set. Go back to Step 2 to detect or set coordinates.';
  return null;
}

async function run(dryRun: boolean) {
  const config = buildConfig(dryRun);
  const error = validate(config);
  if (error) {
    alert(error);
    return;
  }

  progress.reset();
  outputLinks.classList.add('hidden');
  outputFiles.innerHTML = '';
  generateBtn.disabled = true;
  dryRunBtn.disabled = true;

  try {
    await runSidecarStreaming('binaries/poster-qr-sidecar', {
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
    }, handleProgress, (msg) => progress.log(msg), progress.textEl);
  } finally {
    generateBtn.disabled = false;
    dryRunBtn.disabled = false;
  }
}
