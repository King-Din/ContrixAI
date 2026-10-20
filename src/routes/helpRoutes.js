
"use strict";

const express = require("express");
const {
  searchProjectDocuments
} = require("../controllers/helpController");

const router = express.Router();

router.get(
  "/projects/:projectId/documents/search",
  searchProjectDocuments
);

module.exports = router;
