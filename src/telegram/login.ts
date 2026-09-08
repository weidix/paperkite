import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadSettings } from "../config/settings.js";
import { AppLogger } from "../engine/logger.js";
import { configureTelegramClientFactory, createGramClient } from "./client.js";
import { normalizeSessionName, sessionFilePath, writeSessionFile } from "./session-files.js";

export async function loginSession(name: string, settingsFile: string): Promise<void> {
  if (!input.isTTY) throw new Error("session login needs an interactive terminal");
  const settings = await loadSettings(settingsFile);
  const session = normalizeSessionName(name);
  sessionFilePath(settings.telegram.sessionsDir, session);
  const logger = new AppLogger(settings.logging.level);
  configureTelegramClientFactory(settings, logger);
  const client = createGramClient(session, "");
  const readline = createInterface({ input, output });
  try {
    await client.start({
      phoneNumber: () => readline.question("Phone number: "),
      phoneCode: () => readline.question("Login code: "),
      password: () => readline.question("Two-factor password: "),
      onError: (error: unknown) => logger.warn("session login step failed: " + session, error)
    });
    await writeSessionFile(settings.telegram.sessionsDir, session, client.session.save());
  } finally {
    readline.close();
    await client.disconnect().catch(() => undefined);
  }
}