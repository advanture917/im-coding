import test from "node:test";
import assert from "node:assert/strict";
import { commandLine, splitLongText } from "../src/lib/text.js";

test("commandLine parses slash commands", () => {
  assert.deepEqual(commandLine("/use im-coding"), { name: "/use", args: "im-coding" });
  assert.equal(commandLine("hello"), null);
});

test("splitLongText adds stable chunk prefixes", () => {
  const parts = splitLongText("abcdefghijklmnopqrstuvwxyz", 20);
  assert.ok(parts.length > 1);
  assert.match(parts[0], /^\[1\/\d+\]\n/);
  assert.ok(parts.every((part) => part.length <= 20));
});
