const express = require("express");
const router = express.Router();
const {
  getOutletInventory,
  restockItem,
  getLowStockAlerts,
  reduceStock,
  getInventoryLogs,
  getDailySummary,
  createStockTransfer,
  getStockTransfers,
  saveFranchiseInvoice,
  getFranchiseInvoices,
  updateTransferSales,
} = require("../../controllers/dairy/inventoryController");
const {
  franchiseOrAdmin,
  centralAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Read-only endpoints: Franchise Owner (scoped to their outlet) or Central Admin
router.get("/:franchiseId/low-stock", franchiseOrAdmin, scopeToFranchise, getLowStockAlerts);
router.get("/:franchiseId/logs", franchiseOrAdmin, scopeToFranchise, getInventoryLogs);
router.get("/:franchiseId/daily-summary", franchiseOrAdmin, scopeToFranchise, getDailySummary);
router.get("/:franchiseId/invoices", franchiseOrAdmin, scopeToFranchise, getFranchiseInvoices);
router.post("/:franchiseId/invoices", franchiseOrAdmin, scopeToFranchise, saveFranchiseInvoice);
router.get("/:franchiseId/transfers", franchiseOrAdmin, scopeToFranchise, getStockTransfers);
router.post("/transfer", centralAdmin, createStockTransfer);
router.put("/transfers/:transferId/sales", franchiseOrAdmin, scopeToFranchise, updateTransferSales);
// Public read-only outlet inventory lookup for storefront, PDP, and PLP stock availability
router.get("/:franchiseId", getOutletInventory);

// Mutation endpoints:
// Restocking strictly restricted to Super Admin & Admin ONLY (central warehouse transfer)
router.post("/restock", centralAdmin, restockItem);
// Offline Sales & Stock Reduction: Allowed for Franchise Owners (scoped to their outlet) and Admins
router.post("/reduce", franchiseOrAdmin, scopeToFranchise, reduceStock);

module.exports = router;
