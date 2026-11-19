const express = require("express");
const router = express.Router();
const {
  createChallan,
  getChallans,
  getChallanDetails,
  cancelChallan,
} = require("../../controllers/dairy/stockChallanController");
const {
  centralAdmin,
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Central Admin can create Stock Challans
router.post("/", centralAdmin, createChallan);

// Both Central Admin and Franchise Owners can list challans (scoped)
router.get("/", franchiseOrAdmin, scopeToFranchise, getChallans);

// Details of a single Stock Challan
router.get("/:id", franchiseOrAdmin, getChallanDetails);

// Central Admin cancels a Stock Challan and reverts inventory
router.post("/:id/cancel", centralAdmin, cancelChallan);

module.exports = router;
