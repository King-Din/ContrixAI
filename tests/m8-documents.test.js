"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { splitByHeading } = require("../src/services/documentKnowledgeService");
const { importSchema, searchSchema, objectId } = require("../src/validation/documentSchemas");

test("M8 splits Markdown into heading-aware chunks and retains source path", () => {
  const chunks = splitByHeading("docs/README.md", "# Intro\nFirst paragraph.\n\n## Setup\nInstall dependencies.");
  assert.ok(chunks.length >= 1);
  assert.ok(chunks.every((chunk) => chunk.path === "docs/README.md"));
  assert.ok(chunks.some((chunk) => chunk.heading === "Setup"));
});
test("M8 import schema accepts bounded Markdown text documents", () => {
  const result = importSchema.safeParse({ snapshotId: "demo-v1", visibility: "public", documents: [{ path: "README.md", content: "# Demo\nHello" }] });
  assert.equal(result.success, true);
});
test("M8 rejects unsafe document paths and unexpected fields", () => {
  assert.equal(importSchema.safeParse({ snapshotId: "demo-v1", documents: [{ path: "../.env", content: "secret" }] }).success, false);
  assert.equal(importSchema.safeParse({ snapshotId: "demo-v1", isAdmin: true, documents: [{ path: "README.md", content: "ok" }] }).success, false);
});
test("M8 search schema bounds question and result count", () => {
  assert.equal(searchSchema.safeParse({ question: "How do I install?", limit: 5 }).success, true);
  assert.equal(searchSchema.safeParse({ question: "x", limit: 5000 }).success, false);
});
test("M8 validates project IDs before querying", () => {
  assert.equal(objectId.safeParse("507f1f77bcf86cd799439011").success, true);
  assert.equal(objectId.safeParse("not-an-id").success, false);
});
