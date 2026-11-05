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
} = require("../../controllers/dairy/franchiseController");
const { centralAdmin } = require("../../middleware/auth/adminMiddleware");

// Public endpoints
router.get("/nearby", getNearbyOutlets);
router.get("/qr/:token", scanOutletQr);
router.get("/", listOutlets);
router.get("/:id", getOutletById);

// Central Admin management endpoints
router.post("/", centralAdmin, createFranchise);
router.put("/:id", centralAdmin, updateFranchise);
router.patch("/:id", centralAdmin, updateFranchise);
router.delete("/:id", centralAdmin, deleteFranchise);
router.post("/:id/regenerate-qr", centralAdmin, regenerateQrCode);

module.exports = router;
