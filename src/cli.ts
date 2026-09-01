#!/usr/bin/env node
import { Command } from "commander";
import { access, copyFile } from "node:fs/promises";
import { loadCatalog } from "./config/loader.js";
import { ensureProfile } from "./extensions/profile.js";
import { managePlugins } from "./extensions/manager.js";
import { createApp, defaultLockFile, type PaperkiteApp } from "./app.js";
import { acquireProcessLock } from "./control/process-lock.js";
import { requestControl, startControlServer, type ControlServer } from "./control/socket.js";
import { migrateSessionDirectory } from "./telegram/session-migration.js";

const program = new Command()
  .name("paperkite")
  .description("A focused TypeScript automation runtime for Telegram workflows")
  .version("0.1.0");

program
  .command("init")
  .description("create the local plugin profile directory")
  .option("--profile <name>", "profile name", "default")
  .action(async ({ profile }: { profile: string }) => {
    const directory = await ensureProfile(profile);
    await copyIfMissing("data/settings.example.yml", "data/settings.yml");
    await copyIfMissing("data/flows.example.yml", "data/flows.yml");
    process.stdout.write(directory + "\n");
  });

program
  .command("plugin")
  .description("install, remove, or update plugins in a profile")
  .argument("[pnpmArgs...]", "arguments passed to pnpm")
  .option("--profile <name>", "profile name", "default")
  .allowUnknownOption(true)
  .action((args: string[], options: { profile: string }) => {
    process.exitCode = managePlugins(options.profile, args);
  });

program
  .command("flows")
  .description("list configured flows")
  .option("--flows <file>", "flows file", "data/flows.yml")
  .action(async (options: { flows: string }) => {
    const catalog = await loadCatalog(options.flows);
    const output = {
      triggers: catalog.definitions("trigger"),
      commands: catalog.definitions("command"),
      schedules: catalog.definitions("schedule"),
      services: catalog.definitions("service")
    };
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  });

program
  .command("once")
  .description("run one configured command")
  .argument("<flow>", "command id or command:<id>")
  .option("--payload <json>", "JSON payload merged into the command", "{}")
  .option("--profile <name>", "profile name", "default")
  .option("--settings <file>", "settings file", "data/settings.yml")
  .option("--flows <file>", "flows file", "data/flows.yml")
  .action(async (flow: string, options: { payload: string; profile: string; settings: string; flows: string }) => {
    const app = await createApp({ profile: options.profile, settingsFile: options.settings, flowsFile: options.flows });
    try {
      await app.runtime.runCommand(flow, JSON.parse(options.payload) as unknown);
    } finally {
      await app.runtime.stop();
    }
  });

const service = program
  .command("service")
  .description("inspect or run one configured service");

service
  .command("list")
  .description("list configured services")
  .option("--flows <file>", "flows file", "data/flows.yml")
  .action(async (options: { flows: string }) => {
    const catalog = await loadCatalog(options.flows);
    process.stdout.write(JSON.stringify(catalog.definitions("service"), null, 2) + "\n");
  });

const sessions = program
  .command("sessions")
  .description("manage local Telegram session files");

sessions
  .command("migrate")
  .description("convert SQLite session files into the Node session format")
  .requiredOption("--source <directory>", "source session directory")
  .option("--target <directory>", "target session directory", "data/accounts")
  .option("--force", "replace existing target files")
  .action(async (options: { source: string; target: string; force?: boolean }) => {
    const result = await migrateSessionDirectory(options.source, options.target, options.force === true);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  });

service
  .command("run <id>")
  .description("run one service in the foreground")
  .option("--profile <name>", "profile name", "default")
  .option("--settings <file>", "settings file", "data/settings.yml")
  .option("--flows <file>", "flows file", "data/flows.yml")
  .action(async (id: string, options: { profile: string; settings: string; flows: string }) => {
    const lock = await acquireProcessLock(defaultLockFile());
    let app: PaperkiteApp | undefined;
    let control: ControlServer | undefined;
    try {
      const runningApp = await createApp({ profile: options.profile, settingsFile: options.settings, flowsFile: options.flows });
      app = runningApp;
      await runningApp.runtime.startService(id);
      control = await startControlServer(runningApp.runtime);
      await waitForSignals(async () => {
        await runningApp.runtime.stop();
        await control?.close();
        await lock.release();
      });
    } catch (error) {
      await app?.runtime.stop().catch(() => undefined);
      await control?.close().catch(() => undefined);
      await lock.release();
      throw error;
    }
  });

service
  .command("status [id]")
  .description("read the running process snapshot")
  .action(async (id?: string) => {
    try {
      const snapshot = await requestControl<Record<string, unknown>>({ action: "snapshot" });
      if (!id) {
        process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
        return;
      }
      const active = Array.isArray(snapshot.activeServices) && snapshot.activeServices.includes(id);
      process.stdout.write(JSON.stringify({ id, active }, null, 2) + "\n");
    } catch {
      process.stdout.write(JSON.stringify({ running: false }, null, 2) + "\n");
    }
  });

for (const operation of ["start", "stop", "restart"] as const) {
  service
    .command(`${operation} <id>`)
    .description(`${operation} a service in the running process`)
    .action(async (id: string) => {
      await requestControl({ action: `service.${operation}`, id });
    });
}

program
  .command("run")
  .description("start configured triggers, schedules, and services")
  .option("--profile <name>", "profile name", "default")
  .option("--settings <file>", "settings file", "data/settings.yml")
  .option("--flows <file>", "flows file", "data/flows.yml")
  .action(async (options: { profile: string; settings: string; flows: string }) => {
    const lock = await acquireProcessLock(defaultLockFile());
    let app: PaperkiteApp | undefined;
    let control: ControlServer | undefined;
    try {
      const runningApp = await createApp({ profile: options.profile, settingsFile: options.settings, flowsFile: options.flows });
      app = runningApp;
      await runningApp.runtime.start();
      control = await startControlServer(runningApp.runtime);
      await waitForSignals(async () => {
        await runningApp.runtime.stop();
        await control?.close();
        await lock.release();
      });
    } catch (error) {
      await app?.runtime.stop().catch(() => undefined);
      await control?.close().catch(() => undefined);
      await lock.release();
      throw error;
    }
  });

async function waitForSignals(stop: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const keepAlive = setInterval(() => undefined, 60_000);
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearInterval(keepAlive);
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      void stop().then(resolve, reject);
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

async function copyIfMissing(source: string, target: string): Promise<void> {
  try {
    await access(target);
  } catch {
    await copyFile(source, target);
  }
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
}
