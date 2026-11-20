const express = require("express");
const router = express.Router();
const {
  getChallans,
  getLiveCalculation,
  generateBill,
  getBills,
  recordPayment,
} = require("../../controllers/dairy/outletBillingController");
const {
  centralAdmin,
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Both Central Admin and Franchise Owner can list challans
router.get("/challans", franchiseOrAdmin, scopeToFranchise, getChallans);

// Live calculation (Challan Udhar - Online Sales = Rest - Commission = Outlet Dega)
router.get("/live-calculation", franchiseOrAdmin, scopeToFranchise, getLiveCalculation);

// Generate Bill
router.post("/generate-bill", franchiseOrAdmin, scopeToFranchise, generateBill);

// Bills History
router.get("/bills", franchiseOrAdmin, scopeToFranchise, getBills);

// Record Payment against a Bill
router.post("/bills/:id/pay", centralAdmin, recordPayment);

module.exports = router;

