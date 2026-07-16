/**
 * SourceLogger — Scoped console logger for source adapters.
 *
 * Every log line is prefixed with `[sourceId]` so log output
 * across multiple sources can be filtered at a glance.
 */

export class SourceLogger {
  constructor(private readonly sourceId: string) {}

  log(msg: string, ...args: unknown[]): void {
    console.log(`[${this.sourceId}] ${msg}`, ...args);
  }

  warn(msg: string, ...args: unknown[]): void {
    console.warn(`[${this.sourceId}] ${msg}`, ...args);
  }

  error(msg: string, ...args: unknown[]): void {
    console.error(`[${this.sourceId}] ${msg}`, ...args);
  }

  debug(msg: string, ...args: unknown[]): void {
    if (__DEV__) console.log(`[${this.sourceId}:dbg] ${msg}`, ...args);
  }
}
