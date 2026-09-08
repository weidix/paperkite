import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBarkUrl } from "../packages/notify-bark/src/index.js";

test("Bark GET url follows server/key/title/body path format with encoded segments", () => {
  const title = encodeURIComponent("新消息");
  const body = encodeURIComponent("详情 / 详见");
  assert.equal(
    buildBarkUrl("https://bark.example", "abc123", { title: "新消息", body: "详情 / 详见" }),
    `https://bark.example/abc123/${title}/${body}`
  );
});

test("Bark GET url appends optional params as query", () => {
  assert.equal(
    buildBarkUrl("https://bark.example:444/k", "key", {
      title: "T",
      group: "g",
      level: "critical",
      icon: "icon",
      click: "https://a.b/c",
      copy: "copy"
    }),
    `https://bark.example:444/k/key/T?group=g&level=critical&icon=icon&url=${encodeURIComponent("https://a.b/c")}&copy=copy`
  );
});

test("Bark url drops empty title and body segments", () => {
  assert.equal(buildBarkUrl("https://bark.example", "key", { title: "" }), "https://bark.example/key");
});

test("Bark server must use http or https", () => {
  assert.throws(() => buildBarkUrl("file:///tmp", "key", { title: "T" }), /http or https/);
});