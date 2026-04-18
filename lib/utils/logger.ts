type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) {
  const payload = {
    level,
    scope,
    message,
    ...(meta ? { meta } : {}),
  };

  if (level === "error") {
    console.error(payload);
    return;
  }
  if (level === "warn") {
    console.warn(payload);
    return;
  }
  console.log(payload);
}

export const logger = {
  info(scope: string, message: string, meta?: Record<string, unknown>) {
    write("info", scope, message, meta);
  },
  warn(scope: string, message: string, meta?: Record<string, unknown>) {
    write("warn", scope, message, meta);
  },
  error(scope: string, message: string, meta?: Record<string, unknown>) {
    write("error", scope, message, meta);
  },
};

