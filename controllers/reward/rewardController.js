const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const { RewardService, REWARD_CONFIG } = require("../../services/reward/rewardService");
const RewardTransaction = require("../../models/rewardTransactionModel");
const Order = require("../../models/orderModel");

/**
 * Get current user's reward wallet summary & recent history
 */
const getRewardSummary = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, null, "Authentication required", false));
  }

  const summary = await RewardService.getUserRewardSummary(userId);
  res.json(new ApiResponse(200, summary, "Reward summary fetched successfully", true));
});

/**
 * Get paginated reward transactions
 */
const getRewardTransactions = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, null, "Authentication required", false));
  }

  const { page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 20);
  const skip = (pageNum - 1) * limitNum;

  const total = await RewardTransaction.countDocuments({ userId });
  const transactions = await RewardTransaction.find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  const response = new ApiResponse(200, transactions, "Reward transactions fetched successfully", true);
  response.total = total;
  response.page = pageNum;
  response.limit = limitNum;

  res.json(response);
});

/**
 * Calculate preview points for an order amount
 */
const calculateRewardPreview = asyncHandler(async (req, res) => {
  const { subtotal, phone } = req.query;
  const amount = Number(subtotal || 0);

  let isFirstOrder = false;
  const userPhone = phone || req.user?.phone;
  if (req.user?._id || userPhone) {
    const cleanPhone = String(userPhone || "").replace(/\D/g, "").slice(-10);
    const existingCount = await Order.countDocuments({
      $or: [
        ...(req.user?._id ? [{ user: req.user._id }] : []),
        ...(cleanPhone ? [{ customerPhone: { $regex: cleanPhone + "$" } }] : []),
      ],
      status: { $nin: ["cancelled"] },
    });
    isFirstOrder = existingCount === 0;
  }

  const pointsToEarn = RewardService.calculateEarnedPoints(amount, isFirstOrder);

  res.json(
    new ApiResponse(
      200,
      {
        subtotal: amount,
        isFirstOrder,
        pointsToEarn,
        pointsValueInRupees: pointsToEarn * REWARD_CONFIG.RUPEES_PER_POINT,
        minOrderToEarn: REWARD_CONFIG.MIN_ORDER_FOR_EARNING,
        minPointsToRedeem: REWARD_CONFIG.MIN_POINTS_TO_REDEEM,
        firstOrderMinAmount: REWARD_CONFIG.FIRST_ORDER_MIN_AMOUNT,
        maxRedeemPercent: REWARD_CONFIG.MAX_REDEEM_PERCENT_PER_ORDER,
      },
      "Reward preview calculated",
      true
    )
  );
});

/**
 * Admin: Manually add or adjust reward points for any user
 */
const adminAdjustUserPoints = asyncHandler(async (req, res) => {
  const userId = req.params.userId || req.body.userId;
  const { points, reason } = req.body;

  if (!userId) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "User ID is required", false));
  }

  if (points === undefined || points === null || isNaN(Number(points)) || Number(points) === 0) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Please enter a valid non-zero points amount", false));
  }

  const result = await RewardService.adminAdjustUserPoints({
    userId,
    points: Number(points),
    reason,
    adminUser: req.admin,
  });

  const numPoints = Number(points);
  const actionText = numPoints > 0 ? "added" : "adjusted";
  const userIdentifier = result.user.name || result.user.phone || "user";

  res.status(200).json(
    new ApiResponse(
      200,
      result,
      `Successfully ${actionText} ${Math.abs(numPoints)} reward points for ${userIdentifier}`,
      true
    )
  );
});

/**
 * Admin: Get reward summary and transaction history for any user
 */
const adminGetUserRewardSummary = asyncHandler(async (req, res) => {
  const userId = req.params.userId || req.params.id;
  if (!userId) {
    return res.status(400).json(new ApiResponse(400, null, "User ID is required", false));
  }

  const summary = await RewardService.getUserRewardSummary(userId);
  res.json(new ApiResponse(200, summary, "User reward summary fetched successfully", true));
});

module.exports = {
  getRewardSummary,
  getRewardTransactions,
  calculateRewardPreview,
  adminAdjustUserPoints,
  adminGetUserRewardSummary,
};
