// ============================================
// CUBITOPIA - Debug Logger with Log Levels
// Gates verbose output behind configurable levels
// ============================================

export enum LogLevel {
  NONE = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
  VERBOSE = 5,
}

/** Current global log level. Change at runtime via Logger.level or dev console: Logger.setLevel(n) */
let _level: LogLevel = LogLevel.INFO;

/** Per-category overrides. E.g. Logger.setCategoryLevel('Pathfinder', LogLevel.NONE) */
const _categoryLevels: Map<string, LogLevel> = new Map();

/** Throttle map: category → last-log-timestamp. Prevents spammy per-tick logs. */
const _throttle: Map<string, number> = new Map();

function shouldLog(level: LogLevel, category?: string): boolean {
  if (category) {
    const catLevel = _categoryLevels.get(category);
    if (catLevel !== undefined) return level <= catLevel;
  }
  return level <= _level;
}

export const Logger = {
  get level(): LogLevel { return _level; },
  set level(l: LogLevel) { _level = l; },

  setLevel(l: number): void { _level = l as LogLevel; },

  setCategoryLevel(category: string, level: LogLevel): void {
    _categoryLevels.set(category, level);
  },

  /** Log at ERROR level */
  error(category: string, ...args: unknown[]): void {
    if (shouldLog(LogLevel.ERROR, category)) {
      console.error(`[${category}]`, ...args);
    }
  },

  /** Log at WARN level */
  warn(category: string, ...args: unknown[]): void {
    if (shouldLog(LogLevel.WARN, category)) {
      console.warn(`[${category}]`, ...args);
    }
  },

  /** Log at INFO level — important state changes, one-time events */
  info(category: string, ...args: unknown[]): void {
    if (shouldLog(LogLevel.INFO, category)) {
      console.log(`[${category}]`, ...args);
    }
  },

  /** Log at DEBUG level — per-action details useful during development */
  debug(category: string, ...args: unknown[]): void {
    if (shouldLog(LogLevel.DEBUG, category)) {
      console.log(`[${category}]`, ...args);
    }
  },

  /** Log at VERBOSE level — per-tick / high-frequency spam */
  verbose(category: string, ...args: unknown[]): void {
    if (shouldLog(LogLevel.VERBOSE, category)) {
      console.log(`[${category}]`, ...args);
    }
  },

  /**
   * Throttled log — at most once per `intervalMs` for the given key.
   * Useful for per-tick logs that you still want to see occasionally.
   */
  throttle(level: LogLevel, category: string, intervalMs: number, ...args: unknown[]): void {
    if (!shouldLog(level, category)) return;
    const key = `${category}:${args[0]}`;
    const now = performance.now();
    const last = _throttle.get(key) ?? 0;
    if (now - last >= intervalMs) {
      _throttle.set(key, now);
      console.log(`[${category}]`, ...args);
    }
  },
};

// Expose on window for dev console access:
// e.g.  CubitopiaLogger.setLevel(5)  — enable all logs
// e.g.  CubitopiaLogger.setCategoryLevel('Builder', 0)  — silence builders
if (typeof window !== 'undefined') {
  (window as any).CubitopiaLogger = Logger;
}
