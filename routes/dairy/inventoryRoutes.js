const express = require("express");
const router = express.Router();
const {
  getOutletInventory,
  restockItem,
  getLowStockAlerts,
  reduceStock,
  getInventoryLogs,
} = require("../../controllers/dairy/inventoryController");
const {
  franchiseOrAdmin,
  centralAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Read-only endpoints: Franchise Owner (scoped to their outlet) or Central Admin
router.get("/:franchiseId/low-stock", franchiseOrAdmin, scopeToFranchise, getLowStockAlerts);
router.get("/:franchiseId/logs", franchiseOrAdmin, scopeToFranchise, getInventoryLogs);
router.get("/:franchiseId", franchiseOrAdmin, scopeToFranchise, getOutletInventory);

// Mutation endpoints: Strictly restricted to Super Admin & Admin ONLY (Franchise Owners cannot restock or reduce)
router.post("/restock", centralAdmin, restockItem);
router.post("/reduce", centralAdmin, reduceStock);

module.exports = router;
