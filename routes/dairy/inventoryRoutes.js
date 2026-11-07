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
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// All inventory endpoints require franchise owner or central admin role, with strict outlet scoping
router.use(franchiseOrAdmin);

router.get("/:franchiseId/low-stock", scopeToFranchise, getLowStockAlerts);
router.get("/:franchiseId/logs", scopeToFranchise, getInventoryLogs);
router.get("/:franchiseId", scopeToFranchise, getOutletInventory);
router.post("/restock", scopeToFranchise, restockItem);
router.post("/reduce", scopeToFranchise, reduceStock);

module.exports = router;
