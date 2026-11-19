const express = require("express");
const router = express.Router();
const {
  getCommissionConfig,
  updateCommissionConfig,
  getCommissionLogs,
} = require("../../controllers/dairy/commissionController");
const {
  centralAdmin,
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Get commission config for a franchise
router.get("/:franchiseId", franchiseOrAdmin, scopeToFranchise, getCommissionConfig);

// Update commission config (Super Admin ONLY)
router.put("/:franchiseId", centralAdmin, updateCommissionConfig);

// Get commission logs/earnings history for a franchise
router.get("/:franchiseId/logs", franchiseOrAdmin, scopeToFranchise, getCommissionLogs);

module.exports = router;

