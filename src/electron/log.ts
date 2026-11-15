import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

let logFile: string | null = null;

export function logPath(): string {
  return logFile ?? path.join(app.getPath("userData"), "logs", "main.log");
}

/** Append a line to <userData>/logs/main.log (and stderr). Never throws. */
export function log(level: "info" | "warn" | "error", message: string, detail?: unknown): void {
  const extra = detail === undefined ? "" : ` ${detail instanceof Error ? (detail.stack ?? detail.message) : JSON.stringify(detail)}`;
  const line = `${new Date().toISOString()} [${level}] ${message}${extra}\n`;
  process.stderr.write(line);
  try {
    logFile ??= logPath();
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    // logging must never take the app down
  }
}
