/**
 * Structured Logging Utility
 * Ensures consistent log format across all services
 */

type LogFunction = (messageOrMeta: string | Record<string, any>, metaOrMessage?: any) => void;
type Logger = {
  info: LogFunction;
  warn: LogFunction;
  error: LogFunction;
  metrics: LogFunction;
};

function write(level: "INFO" | "WARN" | "ERROR" | "METRIC", service: string, event: string, meta?: any) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service,
    event,
    message: event,
    ...(meta || {}),
  };

  const line = JSON.stringify(payload);
  if (level === "WARN") return console.warn(line);
  if (level === "ERROR") return console.error(line);
  return console.info(line);
}

function normalizeArgs(messageOrMeta: string | Record<string, any>, metaOrMessage?: any) {
  if (typeof messageOrMeta === "string") {
    return { event: messageOrMeta, meta: metaOrMessage };
  }

  if (typeof metaOrMessage === "string") {
    return { event: metaOrMessage, meta: messageOrMeta };
  }

  return {
    event: "log.event",
    meta: {
      ...(messageOrMeta || {}),
      ...(metaOrMessage || {}),
    },
  };
}

function createLogger(service: string): Logger {
  return {
    info: (messageOrMeta: string | Record<string, any>, metaOrMessage?: any) => {
      const { event, meta } = normalizeArgs(messageOrMeta, metaOrMessage);
      write("INFO", service, event, meta);
    },

    warn: (messageOrMeta: string | Record<string, any>, metaOrMessage?: any) => {
      const { event, meta } = normalizeArgs(messageOrMeta, metaOrMessage);
      write("WARN", service, event, meta);
    },

    error: (messageOrMeta: string | Record<string, any>, metaOrMessage?: any) => {
      const { event, meta } = normalizeArgs(messageOrMeta, metaOrMessage);
      write("ERROR", service, event, meta);
    },

    metrics: (messageOrMeta: string | Record<string, any>, metaOrMessage?: any) => {
      const { event, meta } = normalizeArgs(messageOrMeta, metaOrMessage);
      write("METRIC", service, event, meta);
    },
  };
}

export function getLogger(service: string): Logger {
  return createLogger(service);
}

// Default logger instance
export const logger = createLogger("app");
