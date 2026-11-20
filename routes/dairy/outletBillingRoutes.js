const express = require("express");
const router = express.Router();
const {
  getChallans,
  getLiveCalculation,
  generateBill,
  getBills,
  recordPayment,
  updateBillStatus,
  deleteBill,
  resetData,
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

// Super Admin Update Payment Status (Mark Paid / Unpaid / Partial Outstanding Due)
router.patch("/bills/:id/status", centralAdmin, updateBillStatus);

// Super Admin Delete Bill (Cleanup past wrong bill)
router.delete("/bills/:id", centralAdmin, deleteBill);

// Super Admin Reset All Past Billing & Challan Data
router.post("/reset-data", centralAdmin, resetData);
router.delete("/reset-data", centralAdmin, resetData);

module.exports = router;

