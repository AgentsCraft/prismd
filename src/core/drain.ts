/** Active in-flight stream tracking for graceful shutdown. */

let active = 0;
let drainResolve: ((drained: boolean) => void) | undefined;
let shuttingDown = false;

export function beginStream(): void {
  active += 1;
}

export function endStream(): void {
  active -= 1;
  if (active <= 0) {
    active = 0;
    drainResolve?.(true);
    drainResolve = undefined;
  }
}

/**
 * Resolve true when all in-flight streams finished, or false on timeout.
 *
 * Guarded against re-entry: a second shutdown signal (SIGINT then SIGTERM)
 * must not start a competing wait that would strand the first promise
 * until its timeout — it resolves immediately instead.
 */
export function waitForStreams(timeoutMs: number): Promise<boolean> {
  if (active === 0) return Promise.resolve(true);
  if (shuttingDown) return Promise.resolve(true);
  shuttingDown = true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      drainResolve = undefined;
      resolve(false);
    }, timeoutMs);
    drainResolve = (drained: boolean) => {
      clearTimeout(timer);
      resolve(drained);
    };
  });
}

/** Number of streams still in flight (test observability). */
export function activeStreamCount(): number {
  return active;
}

/** Reset module state (test observability). */
export function resetDrainForTests(): void {
  active = 0;
  drainResolve = undefined;
  shuttingDown = false;
}
