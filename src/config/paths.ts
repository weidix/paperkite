import { homedir } from "node:os";
import { join } from "node:path";

export function paperkiteHome(): string {
  return process.env.PAPERKITE_HOME?.trim() || join(homedir(), ".paperkite");
}

export function defaultSettingsFile(): string {
  return join(paperkiteHome(), "settings.yml");
}

export function defaultFlowsFile(): string {
  return join(paperkiteHome(), "flows.yml");
}
