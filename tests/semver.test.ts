import { test } from "node:test";
import assert from "node:assert/strict";
import { maxSatisfying, satisfiesRange } from "../src/extensions/semver.js";
import { HOST_OWNED_PACKAGES } from "../src/extensions/host-owned.js";
import { diagnosePlugin } from "../src/extensions/loader.js";
import { evaluateCompatibility } from "../src/extensions/abi.js";
import { coreRoot } from "../src/extensions/loader.js";

test("wildcard ranges admit every stable version", () => {
  for (const range of ["*", "x", "~*", "^*", "=*", ">=*", "<=*"]) {
    assert.equal(satisfiesRange("1.2.3", range), true, range);
    assert.equal(maxSatisfying(["1.0.0", "1.2.3", "2.0.0"], range), "2.0.0", range);
  }
  assert.equal(satisfiesRange("1.2.3", "1.x - *"), true);
  assert.equal(satisfiesRange("1.2.3", "1.2 <=x"), true);
});

test("prerelease versions stay gated on a same-triple prerelease comparator", () => {
  assert.equal(satisfiesRange("1.3.2-0", "^1.2.3"), false);
  assert.equal(satisfiesRange("1.2.3-0", "^1.2.3"), false);
  assert.equal(satisfiesRange("1.2.3-alpha", "^1.2.3-alpha"), true);
  assert.equal(satisfiesRange("1.0.0-alpha", "*"), false);
});

test("a wildcard sdk declaration loads without an abi", () => {
  assert.deepEqual(evaluateCompatibility(["*"]), { verdict: "load" });
});

test("a wildcard peer range produces no deviation", () => {
  const report = diagnosePlugin(
    "/tmp/plugin",
    { peerDependencies: { telegram: "*" } },
    HOST_OWNED_PACKAGES,
    coreRoot(),
    "/tmp/profile"
  );
  assert.ok(report.deviations.every((item) => item.package !== "telegram" || item.code !== "peer-range"));
});

test("a yaml dependency outside the host-owned list is clean", () => {
  const report = diagnosePlugin(
    "/tmp/plugin",
    { dependencies: { yaml: "^2.0.0" } },
    HOST_OWNED_PACKAGES,
    coreRoot(),
    "/tmp/profile"
  );
  assert.deepEqual(report, { verdict: "ok", deviations: [] });
});
