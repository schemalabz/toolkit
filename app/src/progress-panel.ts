/**
 * Manages a progress section containing .progress-bar, .progress-text, and .tool-log.
 * Both tool modules instantiate one instead of manually managing DOM refs + reset logic.
 */
export class ProgressPanel {
  private section: HTMLElement;
  private bar: HTMLElement;
  private text: HTMLElement;
  private logEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.section = container.querySelector('.progress-section')!;
    this.bar = this.section.querySelector('.progress-bar')!;
    this.text = this.section.querySelector('.progress-text')!;
    this.logEl = this.section.querySelector('.tool-log')!;
  }

  get textEl(): HTMLElement {
    return this.text;
  }

  reset() {
    this.section.classList.remove('hidden');
    this.bar.style.width = '0%';
    this.bar.classList.remove('done');
    this.text.textContent = 'Starting...';
    this.logEl.textContent = '';
  }

  log(msg: string) {
    this.logEl.textContent += msg + '\n';
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  setProgress(pct: number) {
    this.bar.style.width = `${pct}%`;
  }

  complete(msg: string) {
    this.bar.style.width = '100%';
    this.bar.classList.add('done');
    this.text.textContent = msg;
  }

  setError(msg: string) {
    this.text.textContent = `Error: ${msg}`;
  }

  setText(msg: string) {
    this.text.textContent = msg;
  }
}
