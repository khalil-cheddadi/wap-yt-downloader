export type LogLevel = "INFO" | "WARN" | "ERROR";
export type LogCategory = "SERVER" | "HTTP" | "SEARCH" | "JOB" | "MEDIA";

let activeConnections = 0;

export function getActiveConnections(): number {
  return activeConnections;
}

export function incrementConnections(): number {
  activeConnections++;
  return activeConnections;
}

export function decrementConnections(): number {
  activeConnections = Math.max(0, activeConnections - 1);
  return activeConnections;
}

export function generateReqId(): string {
  return `req-${Math.random().toString(36).substring(2, 8)}`;
}

export function formatTimestamp(): string {
  return new Date().toISOString();
}

export interface LogOptions {
  level?: LogLevel;
  category: LogCategory;
  id?: string;
  meta?: Record<string, any>;
}

export function log(message: string, options: LogOptions): void {
  const level = options.level || "INFO";
  const timestamp = formatTimestamp();
  const cat = options.category;
  const idStr = options.id ? ` [${options.id}]` : "";

  let metaStr = "";
  if (options.meta && Object.keys(options.meta).length > 0) {
    const parts = Object.entries(options.meta).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
    metaStr = ` | ${parts.join(" | ")}`;
  }

  const logLine = `${timestamp} [${level}] [${cat}]${idStr} ${message}${metaStr}`;

  if (level === "ERROR") {
    console.error(logLine);
  } else if (level === "WARN") {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }
}

export const logger = {
  info(category: LogCategory, message: string, id?: string, meta?: Record<string, any>) {
    log(message, { level: "INFO", category, id, meta });
  },
  warn(category: LogCategory, message: string, id?: string, meta?: Record<string, any>) {
    log(message, { level: "WARN", category, id, meta });
  },
  error(category: LogCategory, message: string, id?: string, meta?: Record<string, any>) {
    log(message, { level: "ERROR", category, id, meta });
  },
  httpIn(reqId: string, method: string, pathname: string, userAgent?: string | null) {
    const active = incrementConnections();
    const meta: Record<string, any> = { "Active Conns": active };
    if (userAgent) meta["UA"] = userAgent;
    log(`IN  ${method} ${pathname}`, { level: "INFO", category: "HTTP", id: reqId, meta });
  },
  httpOut(reqId: string, method: string, pathname: string, status: number, durationMs: number, extraMeta?: Record<string, any>) {
    const active = decrementConnections();
    const meta: Record<string, any> = {
      Duration: `${durationMs.toFixed(1)}ms`,
      "Active Conns": active,
      ...extraMeta,
    };
    log(`OUT ${method} ${pathname} ${status}`, { level: "INFO", category: "HTTP", id: reqId, meta });
  },
};
