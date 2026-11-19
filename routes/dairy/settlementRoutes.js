const express = require("express");
const router = express.Router();
const {
  previewSettlement,
  confirmSettlement,
  recordSettlementPayment,
  getSettlements,
  getSettlementDetails,
} = require("../../controllers/dairy/settlementController");
const {
  centralAdmin,
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Preview settlement calculation
router.get("/preview", franchiseOrAdmin, scopeToFranchise, previewSettlement);
router.post("/preview", franchiseOrAdmin, scopeToFranchise, previewSettlement);

// Confirm and generate immutable settlement
router.post("/confirm", centralAdmin, confirmSettlement);
router.post("/", centralAdmin, confirmSettlement);

// List settlements
router.get("/", franchiseOrAdmin, scopeToFranchise, getSettlements);

// Details of a single settlement
router.get("/:id", franchiseOrAdmin, getSettlementDetails);

// Record payment received against settlement
router.post("/:id/payment", centralAdmin, recordSettlementPayment);

module.exports = router;

