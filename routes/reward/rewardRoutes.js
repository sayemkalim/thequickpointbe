const express = require("express");
const router = express.Router();
const { user, optionalUser } = require("../../middleware/auth/userMiddleware");
const { centralAdmin } = require("../../middleware/auth/adminMiddleware");
const {
  getRewardSummary,
  getRewardTransactions,
  calculateRewardPreview,
  adminAdjustUserPoints,
  adminGetUserRewardSummary,
} = require("../../controllers/reward/rewardController");

// Customer Endpoints
router.get("/summary", user, getRewardSummary);
router.get("/transactions", user, getRewardTransactions);
router.get("/preview", optionalUser, calculateRewardPreview);

// Admin Endpoints: View & Adjust any user's reward points
router.post("/admin/adjust-points", centralAdmin, adminAdjustUserPoints);
router.post("/admin/users/:userId/adjust-points", centralAdmin, adminAdjustUserPoints);
router.get("/admin/users/:userId/summary", centralAdmin, adminGetUserRewardSummary);

module.exports = router;
