"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { splitByHeading, retrieveDocuments } = require("../src/services/documentKnowledgeService");
const { importSchema, searchSchema, objectId } = require("../src/validation/documentSchemas");
const { HelpArticle } = require("../src/models/HelpArticle");
const { RepositorySnapshot } = require("../src/models/RepositorySnapshot");
const { DocumentChunk } = require("../src/models/DocumentChunk");

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

test("M8: HelpArticle model initializes with valid fields", async () => {
  const article = new HelpArticle({
    projectId: "507f1f77bcf86cd799439011",
    snapshotId: "demo-v1",
    chunkId: "chunk-1",
    path: "docs/setup.md",
    heading: "Getting Started",
    content: "Follow these steps to set up the app.",
    visibility: "public",
    status: "published"
  });
  await assert.doesNotReject(() => article.validate());
  assert.equal(article.status, "published");
  assert.equal(article.visibility, "public");
});

test("M8: T14 - Private snapshot is concealed from anonymous / unauthorized search", async () => {
  const origFindSnap = RepositorySnapshot.find;
  const origFindChunk = DocumentChunk.find;

  try {
    // Only a private snapshot exists
    RepositorySnapshot.find = () => ({
      sort: () => ({
        lean: async () => [
          {
            snapshotId: "secret-v1",
            visibility: "private",
            importedBy: "64b000000000000000000099",
            importedAt: new Date()
          }
        ]
      })
    });

    DocumentChunk.find = () => ({
      select: () => ({
        limit: () => ({
          lean: async () => [
            {
              chunkId: "c-secret-1",
              snapshotId: "secret-v1",
              visibility: "private",
              path: "SECRET.md",
              heading: "Secrets",
              content: "Confidential credentials",
              importedAt: new Date()
            }
          ]
        })
      })
    });

    // Anonymous caller
    const resultAnon = await retrieveDocuments({
      projectId: "507f1f77bcf86cd799439011",
      auth: null,
      question: "What are the secrets?"
    });

    assert.equal(resultAnon.status, "no_evidence");
    assert.deepEqual(resultAnon.references, []);

    // Guest contributor caller
    const resultGuest = await retrieveDocuments({
      projectId: "507f1f77bcf86cd799439011",
      auth: { userId: "64b000000000000000000001", role: "contributor", projectAccess: false },
      question: "What are the secrets?"
    });

    assert.equal(resultGuest.status, "no_evidence");
    assert.deepEqual(resultGuest.references, []);
  } finally {
    RepositorySnapshot.find = origFindSnap;
    DocumentChunk.find = origFindChunk;
  }
});
