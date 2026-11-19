const express = require("express");
const router = express.Router();
const {
  getGlobalSummary,
  getFranchiseSummary,
  getFranchiseStatement,
  postAdjustment,
} = require("../../controllers/dairy/franchiseAccountController");
const {
  centralAdmin,
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Central Admin global overview across all franchises
router.get("/summary", centralAdmin, getGlobalSummary);

// Franchise-specific account summary
router.get("/:franchiseId/summary", franchiseOrAdmin, scopeToFranchise, getFranchiseSummary);

// Franchise-specific Khata Book ledger statement
router.get("/:franchiseId/statement", franchiseOrAdmin, scopeToFranchise, getFranchiseStatement);

// Central Admin posts manual debit or credit adjustment
router.post("/:franchiseId/adjustment", centralAdmin, postAdjustment);

module.exports = router;

