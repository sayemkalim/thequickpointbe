const express = require("express");
const router = express.Router();
const {
  getWholesaleReport,
  getKhataOverviewReport,
  getCustomerDuesReport,
  getInventoryReconciliationReport,
} = require("../../controllers/dairy/dairyReportsController");
const {
  centralAdmin,
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Central Admin wholesale dispatches report
router.get("/wholesale", centralAdmin, getWholesaleReport);

// Central Admin overview of all franchise accounts
router.get("/khata-overview", centralAdmin, getKhataOverviewReport);

// Customer dues report (Franchise owner or Central Admin)
router.get("/customer-dues", franchiseOrAdmin, scopeToFranchise, getCustomerDuesReport);

// Inventory reconciliation report (Franchise owner or Central Admin)
router.get("/inventory-reconciliation", franchiseOrAdmin, scopeToFranchise, getInventoryReconciliationReport);

module.exports = router;

