/** Active in-flight stream tracking for graceful shutdown. */

let active = 0;
let drainResolve: ((drained: boolean) => void) | undefined;

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
 */
export function waitForStreams(timeoutMs: number): Promise<boolean> {
  if (active === 0) return Promise.resolve(true);
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
