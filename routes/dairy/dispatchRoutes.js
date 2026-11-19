const express = require("express");
const router = express.Router();
const {
  createDispatchInvoice,
  getDispatchInvoices,
  getDispatchDetails,
  confirmStockReceipt,
  cancelDispatchInvoice,
} = require("../../controllers/dairy/stockDispatchController");
const {
  centralAdmin,
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Central Admin can create dispatches
router.post("/", centralAdmin, createDispatchInvoice);

// Both Central Admin and Franchise Owners can list dispatches (scoped)
router.get("/", franchiseOrAdmin, scopeToFranchise, getDispatchInvoices);

// Details of a single dispatch
router.get("/:id", franchiseOrAdmin, getDispatchDetails);

// Franchise owner confirms receipt (or Central Admin on behalf)
router.post("/:id/receive", franchiseOrAdmin, confirmStockReceipt);

// Central Admin cancels dispatch
router.post("/:id/cancel", centralAdmin, cancelDispatchInvoice);

module.exports = router;

