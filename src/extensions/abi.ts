import { parseRange, parseVersion, rangeAbi, satisfies, type Range } from "./semver.js";

export const SDK_PACKAGE = "@paperkite/sdk";

/** 本 Core 提供的 SDK 版本；ABI 代际取其 major。 */
export const CORE_SDK_VERSION = "0.2.2";

export const CORE_ABI = Number(CORE_SDK_VERSION.split(".")[0]);

export const UNSUPPORTED_ABI: readonly number[] = [];

export interface CoreAbiPolicy {
  readonly sdkVersion: string;
  readonly abi: number;
  readonly unsupported: readonly number[];
}

export const CORE_POLICY: CoreAbiPolicy = {
  sdkVersion: CORE_SDK_VERSION,
  abi: CORE_ABI,
  unsupported: UNSUPPORTED_ABI
};

export interface DependencyManifest {
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly peerDependencies?: Record<string, unknown>;
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"] as const;

export function sdkDeclarations(manifest: DependencyManifest): readonly string[] {
  const declarations: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const value = manifest[field]?.[SDK_PACKAGE];
    if (typeof value === "string" && value.trim()) declarations.push(value.trim());
  }
  return declarations;
}

export type CompatibilityVerdict =
  | { readonly verdict: "load"; readonly abi?: number }
  | { readonly verdict: "warn"; readonly abi: number; readonly detail: string }
  | { readonly verdict: "reject"; readonly detail: string };

/** 未引入 SDK、宽松声明与无法解析的声明都不构成版本约束。 */
export function evaluateCompatibility(
  declarations: readonly string[],
  policy: CoreAbiPolicy = CORE_POLICY
): CompatibilityVerdict {
  const declared = declarations
    .map((text) => ({ text, range: parseRange(text) }))
    .filter((entry): entry is { text: string; range: Range } => entry.range !== undefined);
  if (!declared.length) return { verdict: "load" };
  const current = parseVersion(policy.sdkVersion);
  if (!current) return { verdict: "load" };
  const abi = Math.max(...declared.map((entry) => rangeAbi(entry.range)));
  if (policy.unsupported.includes(abi)) {
    return { verdict: "reject", detail: "declares ABI " + abi + ", marked unsupported by this core" };
  }
  for (const entry of declared) {
    if (!satisfies(entry.range, current)) {
      return {
        verdict: "reject",
        detail:
          "declares " + SDK_PACKAGE + " " + entry.text +
          ", which core " + policy.sdkVersion + " does not satisfy"
      };
    }
  }
  if (abi > policy.abi) {
    return {
      verdict: "warn",
      abi,
      detail:
        "declares ABI " + abi + " while core provides ABI " + policy.abi +
        "; it may rely on capabilities this core lacks"
    };
  }
  return { verdict: "load", abi };
}
