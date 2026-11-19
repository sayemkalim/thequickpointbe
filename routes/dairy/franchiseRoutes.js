const express = require("express");
const router = express.Router();
const {
  getNearbyOutlets,
  scanOutletQr,
  listOutlets,
  getOutletById,
  createFranchise,
  updateFranchise,
  deleteFranchise,
  regenerateQrCode,
  updateOutletLocation,
} = require("../../controllers/dairy/franchiseController");
const {
  getFranchiseSalesSummary,
  getFranchiseStockSummary,
} = require("../../controllers/dairy/settlementController");
const { centralAdmin, franchiseOrAdmin } = require("../../middleware/auth/adminMiddleware");

// Public endpoints
router.get("/nearby", getNearbyOutlets);
router.get("/qr/:token", scanOutletQr);
router.get("/", listOutlets);
router.get("/:id", getOutletById);
router.get("/:id/sales-summary", franchiseOrAdmin, getFranchiseSalesSummary);
router.get("/:id/stock-summary", franchiseOrAdmin, getFranchiseStockSummary);

// Outlet Location GPS Capture (Accessible by Central Admin OR assigned Franchise Owner from store)
router.patch("/:id/location", franchiseOrAdmin, updateOutletLocation);
router.put("/:id/location", franchiseOrAdmin, updateOutletLocation);

// Central Admin management endpoints
router.post("/", centralAdmin, createFranchise);
router.put("/:id", centralAdmin, updateFranchise);
router.patch("/:id", centralAdmin, updateFranchise);
router.delete("/:id", centralAdmin, deleteFranchise);
router.post("/:id/regenerate-qr", centralAdmin, regenerateQrCode);

module.exports = router;
