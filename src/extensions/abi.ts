export const SDK_PACKAGE = "@paperkite/sdk";

/** 本 Core 提供的 SDK 版本；ABI 代际取其 major。 */
export const CORE_SDK_VERSION = "0.2.0";

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
  const abi = Math.max(...declared.map((entry) => abiOf(entry.range)));
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

interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (number | string)[];
}

type Operator = ">" | ">=" | "<" | "<=" | "=";

interface Comparator {
  readonly op: Operator;
  readonly version: Version;
}

type ComparatorSet = readonly Comparator[];

type Range = readonly ComparatorSet[];

interface PartialVersion {
  readonly major: number;
  readonly minor?: number;
  readonly patch?: number;
  readonly prerelease: readonly (number | string)[];
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const PARTIAL_PATTERN = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/;
const COMPARATOR_PATTERN = /^(>=|<=|>|<|=|\^|~>|~)?(.+)$/;

function parseVersion(text: string): Version | undefined {
  const match = VERSION_PATTERN.exec(text);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return version(Number(match[1]), Number(match[2]), Number(match[3]), identifiers(match[4]));
}

function version(
  major: number,
  minor: number,
  patch: number,
  prerelease: readonly (number | string)[] = []
): Version {
  return { major, minor, patch, prerelease };
}

function identifiers(text: string | undefined): readonly (number | string)[] {
  if (!text) return [];
  return text.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function component(token: string | undefined): number | "*" | undefined {
  if (token === undefined) return undefined;
  if (token === "*" || token === "x" || token === "X") return "*";
  return /^\d+$/.test(token) ? Number(token) : undefined;
}

function parsePartial(text: string): PartialVersion | undefined {
  const match = PARTIAL_PATTERN.exec(text);
  if (!match) return undefined;
  const major = component(match[1]);
  const minor = component(match[2]);
  const patch = component(match[3]);
  if (typeof major !== "number") return undefined;
  if (minor === undefined && match[2] !== undefined) return undefined;
  if (patch === undefined && match[3] !== undefined) return undefined;
  if (minor === "*" && typeof patch === "number") return undefined;
  const prerelease = identifiers(match[4]);
  if (prerelease.length && typeof patch !== "number") return undefined;
  return {
    major,
    minor: minor === "*" ? undefined : minor,
    patch: patch === "*" ? undefined : patch,
    prerelease
  };
}

function expand(op: string | undefined, partial: PartialVersion): ComparatorSet | undefined {
  const { major, minor, patch, prerelease } = partial;
  const atLeast = (): Comparator => ({
    op: ">=",
    version: version(major, minor ?? 0, patch ?? 0, prerelease)
  });
  const below = (value: number, middle = 0, last = 0): Comparator => ({
    op: "<",
    version: version(value, middle, last)
  });
  const at = (value: number, middle = 0, last = 0): Comparator => ({
    op: ">=",
    version: version(value, middle, last)
  });
  const exact = (operator: Operator): ComparatorSet => [
    { op: operator, version: version(major, minor ?? 0, patch ?? 0, prerelease) }
  ];
  switch (op) {
    case ">":
      if (patch !== undefined) return exact(">");
      if (minor !== undefined) return [at(major, minor + 1)];
      return [at(major + 1)];
    case ">=":
      return [atLeast()];
    case "<":
      if (patch !== undefined) return exact("<");
      return [below(major, minor ?? 0)];
    case "<=":
      if (patch !== undefined) return exact("<=");
      if (minor !== undefined) return [below(major, minor + 1)];
      return [below(major + 1)];
    case "^":
      if (major > 0) return [atLeast(), below(major + 1)];
      if (minor === undefined) return [atLeast(), below(1)];
      if (minor > 0) return [atLeast(), below(0, minor + 1)];
      if (patch !== undefined) return [atLeast(), below(0, 0, patch + 1)];
      return [atLeast(), below(0, 1)];
    case "~":
    case "~>":
      if (minor === undefined) return [atLeast(), below(major + 1)];
      return [atLeast(), below(major, minor + 1)];
    case "=":
    case undefined:
      if (patch !== undefined) return exact("=");
      if (minor !== undefined) return [atLeast(), below(major, minor + 1)];
      return [atLeast(), below(major + 1)];
    default:
      return undefined;
  }
}

function parseRange(text: string): Range | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const sets: ComparatorSet[] = [];
  for (const clause of trimmed.split("||")) {
    const hyphen = /^(.+?)\s+-\s+(.+)$/.exec(clause.trim());
    if (hyphen?.[1] && hyphen[2]) {
      const from = parsePartial(hyphen[1]);
      const to = parsePartial(hyphen[2]);
      if (!from || !to) return undefined;
      const lower = expand(">=", from);
      const upper = expand("<=", to);
      if (!lower || !upper) return undefined;
      sets.push([...lower, ...upper]);
      continue;
    }
    const comparators: Comparator[] = [];
    const normalized = clause.trim().replace(/(>=|<=|>|<|=|\^|~>|~)\s+/g, "$1");
    for (const token of normalized.split(/\s+/)) {
      if (!token) continue;
      const match = COMPARATOR_PATTERN.exec(token);
      if (!match?.[2]) return undefined;
      const partial = parsePartial(match[2]);
      if (!partial) return undefined;
      const expanded = expand(match[1], partial);
      if (!expanded) return undefined;
      comparators.push(...expanded);
    }
    if (!comparators.length) return undefined;
    sets.push(comparators);
  }
  return sets.length ? sets : undefined;
}

function satisfies(range: Range, current: Version): boolean {
  return range.some((set) => set.every((comparator) => holds(comparator, current)));
}

function holds(comparator: Comparator, current: Version): boolean {
  const order = compare(current, comparator.version);
  switch (comparator.op) {
    case "=":
      return order === 0;
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
  }
}

function compare(left: Version, right: Version): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

function comparePrerelease(left: readonly (number | string)[], right: readonly (number | string)[]): number {
  if (!left.length || !right.length) return left.length === right.length ? 0 : left.length ? -1 : 1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

/** 范围为插件接受的 ABI 代际上限；无上限时取所需的最低代际。 */
function abiOf(range: Range): number {
  let abi = 0;
  for (const set of range) {
    let lowest = 0;
    let highest: number | undefined;
    for (const comparator of set) {
      if (comparator.op === "<") {
        highest = Math.min(highest ?? Number.POSITIVE_INFINITY, majorBelow(comparator.version));
      } else if (comparator.op === "<=") {
        highest = Math.min(highest ?? Number.POSITIVE_INFINITY, comparator.version.major);
      } else {
        lowest = Math.max(lowest, comparator.version.major);
      }
    }
    abi = Math.max(abi, highest ?? lowest);
  }
  return abi;
}

function majorBelow(version: Version): number {
  return version.minor === 0 && version.patch === 0 ? Math.max(0, version.major - 1) : version.major;
}
