const express = require("express");
const router = express.Router();
const {
  getStoreSettings,
  updateStoreSettings,
  getCommissionLedger,
  markPayout,
} = require("../../controllers/dairy/settingsController");
const {
  centralAdmin,
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Store Settings (Central Admin only)
router.get("/", centralAdmin, getStoreSettings);
router.patch("/", centralAdmin, updateStoreSettings);

// Commission Ledger (Central Admin sees all; Franchise Owner scoped to their franchise)
router.get("/commission/ledger", franchiseOrAdmin, scopeToFranchise, getCommissionLedger);

// Commission Payout (Central Admin only)
router.patch("/commission/payout", centralAdmin, markPayout);

module.exports = router;
