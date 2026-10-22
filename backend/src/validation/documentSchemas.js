"use strict";
const { z } = require("zod");
const objectId = z.string().trim().refine(
  (val) => /^[a-f\d]{24}$/i.test(val) || /^seed-[a-z0-9-]+$/i.test(val),
  { message: "Must be a valid MongoDB ObjectId" }
);
const sourceDoc = z.object({
  path: z.string().trim().min(1).max(300).refine((p) => !p.startsWith("/") && !p.includes("..") && !p.includes("\\") && !p.includes("\0"), "Path must be a safe relative path"),
  content: z.string().min(1).max(100000),
  contentType: z.enum(["text/markdown", "text/plain", "text/x-markdown"]).optional().default("text/markdown")
}).strict();
const importSchema = z.object({
  snapshotId: z.string().trim().min(1).max(120).regex(/^[\w.-]+$/),
  sourceUrl: z.string().trim().max(2048).optional().default(""),
  commit: z.string().trim().max(100).optional().default(""),
  visibility: z.enum(["public", "private"]).default("public"),
  documents: z.array(sourceDoc).min(1).max(100),
  replaceExisting: z.boolean().default(false)
}).strict();
const searchSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  snapshotId: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(10).default(5)
}).strict();
module.exports = { objectId, importSchema, searchSchema };
