const express = require("express");
const router = express.Router();
const {
  createPosBill,
  getPosBills,
  getPosBillDetails,
  collectCustomerDuePayment,
} = require("../../controllers/dairy/posBillingController");
const {
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Create Walk-in POS Bill
router.post("/", franchiseOrAdmin, scopeToFranchise, createPosBill);

// List Walk-in POS Bills
router.get("/", franchiseOrAdmin, scopeToFranchise, getPosBills);

// Get single POS Bill details
router.get("/:id", franchiseOrAdmin, getPosBillDetails);

// Collect subsequent customer due payment against existing bill
router.post("/:id/collect-due", franchiseOrAdmin, collectCustomerDuePayment);

module.exports = router;

