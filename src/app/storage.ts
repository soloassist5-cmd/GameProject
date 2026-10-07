const BEST_KEY = 'echo.bestDepth';

/** Storage can be unavailable (private mode, blocked cookies) — never let that break the game. */
export function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 1;
  } catch {
    return 1;
  }
}

export function saveBest(depth: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(depth));
  } catch {
    // ignore
  }
}
