/**
 * Shared sidecar harness — decodes base64 input, routes to action handlers,
 * and wraps everything in a top-level error handler.
 */

export type EmitFn = (event: Record<string, unknown>) => void;
export type ActionHandler = (input: Record<string, unknown>, emit: EmitFn) => Promise<void>;

export function createSidecar(actions: Record<string, ActionHandler>): void {
  const emit: EmitFn = (event) => {
    process.stdout.write(JSON.stringify(event) + '\n');
  };

  async function main() {
    const b64 = process.argv[2];
    if (!b64) {
      emit({ type: 'error', message: 'Usage: <sidecar> <base64-json>' });
      process.exit(1);
    }

    let input: { action: string; [key: string]: unknown };
    try {
      const raw = Buffer.from(b64, 'base64').toString('utf-8');
      input = JSON.parse(raw);
    } catch {
      emit({ type: 'error', message: 'Invalid base64 JSON argument' });
      process.exit(1);
    }

    const handler = actions[input.action];
    if (!handler) {
      emit({ type: 'error', message: `Unknown action: ${input.action}` });
      process.exit(1);
    }

    await handler(input, emit);
  }

  main().catch((err) => {
    emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
