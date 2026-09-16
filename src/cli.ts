#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadCatalog } from "./config/loader.js";
import { defaultFlowsFile, defaultSettingsFile, paperkiteHome } from "./config/paths.js";
import { loadSettings, type AppSettings } from "./config/settings.js";
import { coreRoot } from "./extensions/loader.js";
import { ensureProfile } from "./extensions/profile.js";
import { listPlugins, managePlugins, syncBundles, updatePlugins, type SyncResult } from "./extensions/manager.js";
import { createApp, defaultLockFile, type PaperkiteApp } from "./app.js";
import { acquireProcessLock } from "./control/process-lock.js";
import { requestControl, startControlServer, type ControlServer } from "./control/socket.js";
import { loginSession } from "./telegram/login.js";

const manifest = JSON.parse(readFileSync(join(coreRoot(), "package.json"), "utf8")) as { version: string };

const program = new Command()
  .name("paperkite")
  .description("A focused TypeScript automation runtime for Telegram workflows")
  .version(manifest.version);

program
  .command("init")
  .description("create the local plugin profile directory and install bundled plugins")
  .option("--profile <name>", "profile name", "default")
  .option("--offline", "use the cached or built-in bundle manifest")
  .action(async ({ profile, offline }: { profile: string; offline?: boolean }) => {
    const { directory, migration } = await ensureProfile(profile);
    if (migration) process.stderr.write(migration);
    const examples = join(coreRoot(), "data");
    const home = paperkiteHome();
    await copyIfMissing(join(examples, "settings.example.yml"), join(home, "settings.yml"));
    await copyIfMissing(join(examples, "flows.example.yml"), join(home, "flows.yml"));
    const settings = await loadSettings(join(home, "settings.yml")).catch(() => undefined);
    const result = await syncBundles(profile, { settings: settings?.plugins, offline }).catch((error: unknown) => {
      process.stderr.write("paperkite: plugin sync failed: " + detailOf(error) + "\n");
      return undefined;
    });
    if (result) reportSync(result);
    process.stdout.write(directory + "\n");
  });

program
  .command("plugin")
  .description("install, remove, update, or sync plugins in a profile")
  .argument("[args...]", "operation and its arguments, for example `sync` or `add <package>`")
  .option("--profile <name>", "profile name", "default")
  .option("--refresh", "ignore the cached bundle manifest")
  .option("--offline", "use the cached or built-in bundle manifest")
  .option("--check", "report what sync would change")
  .option("--settings <file>", "settings file", defaultSettingsFile())
  .allowUnknownOption(true)
  .action(
    async (
      args: string[],
      options: { profile: string; settings: string; refresh?: boolean; offline?: boolean; check?: boolean }
    ) => {
      process.exitCode = await runPluginCommand(options, args);
    }
  );

program
  .command("flows")
  .description("list configured flows")
  .option("--flows <file>", "flows file", defaultFlowsFile())
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
  .description("run one configured flow")
  .argument("<flow>", "command or schedule id")
  .option("--profile <name>", "profile name", "default")
  .option("--settings <file>", "settings file", defaultSettingsFile())
  .option("--flows <file>", "flows file", defaultFlowsFile())
  .action(async (flow: string, options: { profile: string; settings: string; flows: string }) => {
    const app = await createAppWithSync({
      profile: options.profile,
      settingsFile: options.settings,
      flowsFile: options.flows
    });
    try {
      await app.runtime.runFlow(flow);
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
  .option("--flows <file>", "flows file", defaultFlowsFile())
  .action(async (options: { flows: string }) => {
    const catalog = await loadCatalog(options.flows);
    process.stdout.write(JSON.stringify(catalog.definitions("service"), null, 2) + "\n");
  });

service
  .command("run <id>")
  .description("run one service in the foreground")
  .option("--profile <name>", "profile name", "default")
  .option("--settings <file>", "settings file", defaultSettingsFile())
  .option("--flows <file>", "flows file", defaultFlowsFile())
  .action(async (id: string, options: { profile: string; settings: string; flows: string }) => {
    const lock = await acquireProcessLock(defaultLockFile());
    let app: PaperkiteApp | undefined;
    let control: ControlServer | undefined;
    try {
      const runningApp = await createAppWithSync({
        profile: options.profile,
        settingsFile: options.settings,
        flowsFile: options.flows
      });
      app = runningApp;
      await runningApp.runtime.startService(id);
      control = await startControlServer(runningApp.runtime);
      await waitForSignals(async () => {
        await runningApp.runtime.stop();
        await runningApp.logger.flush();
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

for (const operation of ["start", "stop"] as const) {
  service
    .command(`${operation} <id>`)
    .description(`${operation} a service in the running process`)
    .action(async (id: string) => {
      await requestControl({ action: `service.${operation}`, id });
    });
}

service
  .command("restart <id>")
  .description("reload a service so its current definition applies")
  .action(async (id: string) => {
    await requestControl({ action: "flow.reload", id });
  });

const session = program
  .command("session")
  .description("inspect or manage telegram sessions of the running process");

session
  .command("status [id]")
  .description("read session states")
  .action(async (id?: string) => {
    try {
      const snapshot = await requestControl<{ sessions?: Array<Record<string, unknown>> }>({ action: "snapshot" });
      const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
      if (id) {
        const entry = sessions.find((item) => item.name === id);
        if (!entry) throw new Error("unknown session: " + id);
        process.stdout.write(JSON.stringify(entry, null, 2) + "\n");
        return;
      }
      process.stdout.write(JSON.stringify(sessions, null, 2) + "\n");
    } catch {
      process.stdout.write(JSON.stringify({ running: false }, null, 2) + "\n");
    }
  });

session
  .command("reconnect <id>")
  .description("trigger a session reconnect attempt now")
  .action(async (id: string) => {
    await requestControl({ action: "session.reconnect", id });
  });

session
  .command("login <id>")
  .description("log in a session without a running process")
  .option("--settings <file>", "settings file", defaultSettingsFile())
  .action(async (id: string, options: { settings: string }) => {
    await loginSession(id, options.settings);
    process.stdout.write("session login ok: " + id + "\n");
    await requestControl({ action: "session.reconnect", id }).catch(() => undefined);
  });

program
  .command("plugins")
  .description("list plugins loaded by the running process")
  .action(async () => {
    try {
      const plugins = await requestControl({ action: "plugins" });
      process.stdout.write(JSON.stringify(plugins, null, 2) + "\n");
    } catch {
      process.stdout.write(JSON.stringify({ running: false }, null, 2) + "\n");
    }
  });

program
  .command("run")
  .description("start configured triggers, schedules, and services")
  .option("--profile <name>", "profile name", "default")
  .option("--settings <file>", "settings file", defaultSettingsFile())
  .option("--flows <file>", "flows file", defaultFlowsFile())
  .action(async (options: { profile: string; settings: string; flows: string }) => {
    const lock = await acquireProcessLock(defaultLockFile());
    let app: PaperkiteApp | undefined;
    let control: ControlServer | undefined;
    try {
      const runningApp = await createAppWithSync({
        profile: options.profile,
        settingsFile: options.settings,
        flowsFile: options.flows
      });
      app = runningApp;
      await runningApp.runtime.start();
      control = await startControlServer(runningApp.runtime);
      await waitForSignals(async () => {
        await runningApp.runtime.stop();
        await runningApp.logger.flush();
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

interface AppStartOptions {
  readonly profile: string;
  readonly settingsFile: string;
  readonly flowsFile: string;
}

/** 启动前做一次幂等 sync；失败只警告，流程引用缺失能力时按 unknown capability 报错。 */
async function createAppWithSync(options: AppStartOptions): Promise<PaperkiteApp> {
  const settings = await loadSettings(options.settingsFile);
  if (settings.plugins.autoInstall) {
    const result = await syncBundles(options.profile, { settings: settings.plugins }).catch((error: unknown) => {
      process.stderr.write("paperkite: plugin sync failed: " + detailOf(error) + "\n");
      return undefined;
    });
    if (result) reportSync(result);
  }
  return createApp({ profile: options.profile, flowsFile: options.flowsFile, settings });
}

async function runPluginCommand(
  options: { profile: string; settings: string; refresh?: boolean; offline?: boolean; check?: boolean },
  args: readonly string[]
): Promise<number> {
  const [operation, ...rest] = args;
  const settings = (await loadSettings(options.settings).catch(() => undefined))?.plugins;
  const sync = { settings, refresh: options.refresh, offline: options.offline, check: options.check };
  if (operation === "sync") {
    try {
      const result = await syncBundles(options.profile, sync);
      reportSync(result, true);
      return result.problems.length ? 1 : 0;
    } catch (error) {
      process.stderr.write("paperkite: " + detailOf(error) + "\n");
      return 1;
    }
  }
  if (operation === "update") {
    if (!rest.length) {
      process.stderr.write("paperkite: plugin update needs at least one package name\n");
      return 2;
    }
    const result = await updatePlugins(options.profile, rest, sync);
    reportSync(result, true);
    return result.problems.length ? 1 : 0;
  }
  if (operation === undefined || operation === "list") {
    const entries = await listPlugins(options.profile, sync);
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return 0;
  }
  return await managePlugins(options.profile, args);
}

function reportSync(result: SyncResult, verbose = false): void {
  for (const warning of result.warnings) process.stderr.write("paperkite: " + warning + "\n");
  for (const problem of result.problems) process.stderr.write("paperkite: " + problem + "\n");
  if (!verbose) return;
  const summary = {
    manifest: result.origin,
    manifestVersion: result.manifestVersion,
    installed: result.added,
    kept: result.kept,
    removed: result.removed,
    applied: result.applied
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
}
