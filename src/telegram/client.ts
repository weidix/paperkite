import { join } from "node:path";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Logger as GramLogger, LogLevel } from "telegram/extensions/Logger.js";
import type { RuntimeLogger } from "@paperkite/sdk";
import type { AppSettings } from "../config/settings.js";
import { paperkiteHome } from "../config/paths.js";

export interface SessionClient {
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown>;
  session: { save(): string };
  invoke(request: unknown): Promise<unknown>;
  start(options: {
    phoneNumber: () => Promise<string>;
    phoneCode: () => Promise<string>;
    password: () => Promise<string>;
    onError: (error: unknown) => void;
  }): Promise<unknown>;
}

export function createGramClient(sessionName: string, content: string): SessionClient {
  const session = new StringSession(content);
  return new TelegramClient(session, currentSettings.telegram.apiId, currentSettings.telegram.apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
    ...(currentLogger ? { baseLogger: createGramLogger(currentLogger, currentSettings.logging.level) } : {})
  }) as unknown as SessionClient;
}

let currentSettings: AppSettings = {
  telegram: { apiId: 0, apiHash: "", sessionsDir: join(paperkiteHome(), "accounts") },
  logging: { level: "info", directory: join(paperkiteHome(), "logs") }
};

let currentLogger: RuntimeLogger | undefined;

export function configureTelegramClientFactory(settings: AppSettings, logger?: RuntimeLogger): void {
  currentSettings = settings;
  currentLogger = logger;
}

export function createGramLogger(logger: RuntimeLogger, level: string): GramLogger {
  const gram = new GramLogger(gramLogLevel(level));
  gram.log = (logLevel, message) => {
    switch (logLevel) {
      case LogLevel.ERROR:
        logger.error(message);
        break;
      case LogLevel.WARN:
        logger.warn(message);
        break;
      case LogLevel.DEBUG:
        logger.debug(message);
        break;
      default:
        logger.info(message);
    }
  };
  return gram;
}

function gramLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case "debug":
      return LogLevel.DEBUG;
    case "warn":
      return LogLevel.WARN;
    case "error":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}