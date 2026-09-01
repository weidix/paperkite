import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBarkUrl } from "../packages/bark/src/index.js";

test("Bark endpoint accepts a key placeholder without changing its protocol", () => {
  assert.equal(buildBarkUrl("https://notify.example/{key}", "a/b"), "https://notify.example/a%2Fb");
  assert.throws(() => buildBarkUrl("file:///tmp/{key}", "key"), /http or https/);
});
