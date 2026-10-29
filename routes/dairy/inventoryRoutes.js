const express = require("express");
const router = express.Router();
const {
  getOutletInventory,
  restockItem,
  getLowStockAlerts,
} = require("../../controllers/dairy/inventoryController");
const {
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// All inventory endpoints require franchise owner or central admin role, with strict outlet scoping
router.use(franchiseOrAdmin);

router.get("/:franchiseId", scopeToFranchise, getOutletInventory);
router.get("/:franchiseId/low-stock", scopeToFranchise, getLowStockAlerts);
router.post("/restock", scopeToFranchise, restockItem);

module.exports = router;
