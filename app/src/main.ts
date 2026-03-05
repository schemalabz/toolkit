import { Command } from '@tauri-apps/plugin-shell';

// --- Shared helpers ---

export function toBase64(obj: unknown): string {
  return btoa(JSON.stringify(obj));
}

export function log(logEl: HTMLElement, msg: string) {
  logEl.textContent += msg + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

export async function runSidecar(sidecarName: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cmd = Command.sidecar(sidecarName, [toBase64(input)]);

  return new Promise((resolve) => {
    let output = '';
    cmd.stdout.on('data', (line: string) => {
      output += line + '\n';
    });
    cmd.stderr.on('data', (line: string) => {
      console.warn(`stderr: ${line}`);
    });
    cmd.on('error', (err: string) => {
      console.error(`Sidecar error: ${err}`);
      resolve({ error: err });
    });
    cmd.on('close', (data) => {
      if (data.code !== 0) {
        console.warn(`Sidecar exited with code ${data.code}`);
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
      console.error(`Failed to spawn sidecar: ${err.message}`);
      resolve({ error: err.message });
    });
  });
}

export async function runSidecarStreaming(
  sidecarName: string,
  input: Record<string, unknown>,
  onEvent: (event: { type: string; [key: string]: unknown }) => void,
  logFn: (msg: string) => void,
  progressTextEl: HTMLElement,
) {
  const cmd = Command.sidecar(sidecarName, [toBase64(input)]);

  return new Promise<void>((resolve) => {
    cmd.stdout.on('data', (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line.trim());
        onEvent(event);
      } catch {
        logFn(line);
      }
    });

    cmd.stderr.on('data', (line: string) => {
      logFn(`stderr: ${line}`);
    });

    cmd.on('error', (err: string) => {
      logFn(`Sidecar error: ${err}`);
      progressTextEl.textContent = `Error: ${err}`;
      resolve();
    });

    cmd.on('close', (data) => {
      if (data.code !== 0) {
        logFn(`Sidecar exited with code ${data.code}`);
      }
      resolve();
    });

    cmd.spawn().catch((err: Error) => {
      logFn(`Failed to spawn sidecar: ${err.message}`);
      progressTextEl.textContent = `Failed to start: ${err.message}`;
      resolve();
    });
  });
}

// --- Tool selector / routing ---

const homeView = document.getElementById('tool-home')!;
const posterQrView = document.getElementById('tool-poster-qr')!;
const ytDownloadView = document.getElementById('tool-yt-download')!;
const views = [homeView, posterQrView, ytDownloadView];

function showView(view: HTMLElement) {
  views.forEach(v => v.classList.add('hidden'));
  view.classList.remove('hidden');
}

// Home card clicks
document.getElementById('card-poster-qr')!.addEventListener('click', () => {
  showView(posterQrView);
});

document.getElementById('card-yt-download')!.addEventListener('click', async () => {
  showView(ytDownloadView);
  // Lazy-load and trigger deps check
  const { ensureDeps } = await import('./yt-download');
  ensureDeps();
});

// Back to home buttons
document.querySelectorAll<HTMLElement>('.btn-home').forEach(btn => {
  btn.addEventListener('click', () => showView(homeView));
});

// Load poster-qr module eagerly (it sets up all its own listeners)
import('./poster-qr');
