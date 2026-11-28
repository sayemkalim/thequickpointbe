const User = require("../../models/userModel");
const RewardTransaction = require("../../models/rewardTransactionModel");

const REWARD_CONFIG = {
  POINTS_PER_HUNDRED: 2,
  MIN_ORDER_FOR_EARNING: 100,
  FIRST_ORDER_MIN_AMOUNT: 200,
  FIRST_ORDER_CASHBACK_PERCENT: 100,
  MAX_REDEEM_PERCENT_PER_ORDER: 0.10, // Max 10% of order total can use points
  RUPEES_PER_POINT: 1, // 2 points === ₹2 -> 1 point = ₹1
  MIN_POINTS_TO_REDEEM: 100, // Redeem unlocks when wallet balance >= 100 points
};

class RewardService {
  /**
   * Calculate points earned based on order subtotal.
   * Rule: Min order ₹100. For every ₹100 spent, earn 2 points.
   */
  static calculateEarnedPoints(subtotalAmount, isFirstOrder = false) {
    const amount = Number(subtotalAmount || 0);
    if (isFirstOrder && amount >= REWARD_CONFIG.FIRST_ORDER_MIN_AMOUNT) {
      // 100% cashback in reward points on first order of ₹200 or more
      return Math.floor(amount);
    }
    if (amount < REWARD_CONFIG.MIN_ORDER_FOR_EARNING) {
      return 0;
    }
    return Math.floor(amount / 100) * REWARD_CONFIG.POINTS_PER_HUNDRED;
  }

  /**
   * Check if user is eligible to redeem points.
   * Rule: User must have at least 100 points in their wallet.
   */
  static canRedeemPoints(points) {
    return Number(points || 0) >= REWARD_CONFIG.MIN_POINTS_TO_REDEEM;
  }

  /**
   * Get full reward summary for a user
   */
  static async getUserRewardSummary(userId) {
    if (!userId) {
      return {
        balance: 0,
        valueInRupees: 0,
        minRedeemThreshold: REWARD_CONFIG.MIN_POINTS_TO_REDEEM,
        canRedeem: false,
        pointsPerHundred: REWARD_CONFIG.POINTS_PER_HUNDRED,
        minOrderToEarn: REWARD_CONFIG.MIN_ORDER_FOR_EARNING,
        recentTransactions: [],
      };
    }

    const user = await User.findById(userId).select("name email phone rewardPoints");
    const balance = Math.max(0, Number(user?.rewardPoints || 0));

    const transactions = await RewardTransaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return {
      balance,
      valueInRupees: balance * REWARD_CONFIG.RUPEES_PER_POINT,
      minRedeemThreshold: REWARD_CONFIG.MIN_POINTS_TO_REDEEM,
      maxRedeemPercent: REWARD_CONFIG.MAX_REDEEM_PERCENT_PER_ORDER,
      canRedeem: balance >= REWARD_CONFIG.MIN_POINTS_TO_REDEEM,
      pointsPerHundred: REWARD_CONFIG.POINTS_PER_HUNDRED,
      minOrderToEarn: REWARD_CONFIG.MIN_ORDER_FOR_EARNING,
      firstOrderMinAmount: REWARD_CONFIG.FIRST_ORDER_MIN_AMOUNT,
      recentTransactions: transactions,
    };
  }

  /**
   * Process rewards upon order payment confirmation.
   * 1. Debits redeemed points (if any applied).
   * 2. Credits earned points (if order subtotal >= 100).
   */
  static async processOrderRewardsOnPayment(order) {
    if (!order || !order.user) return;
    const userId = order.user._id || order.user;

    const user = await User.findById(userId);
    if (!user) return;

    let currentBalance = Math.max(0, Number(user.rewardPoints || 0));

    // 1. Process Redeemed Points (Debit)
    const pointsToRedeem = Number(order.rewardPointsRedeemed || 0);
    if (pointsToRedeem > 0) {
      const alreadyRedeemed = await RewardTransaction.findOne({
        orderId: order._id,
        type: "redeemed",
      });

      if (!alreadyRedeemed) {
        currentBalance = Math.max(0, currentBalance - pointsToRedeem);
        user.rewardPoints = currentBalance;
        await user.save();

        await RewardTransaction.create({
          userId,
          type: "redeemed",
          points: -pointsToRedeem,
          amount: pointsToRedeem * REWARD_CONFIG.RUPEES_PER_POINT,
          orderId: order._id,
          orderNumber: String(order.orderNumber || ""),
          description: `Redeemed on Order #${order.orderNumber}`,
          balanceAfter: currentBalance,
        });
      }
    }

    // 2. Process Earned Points (Credit)
    const pointsEarned = Number(order.rewardPointsEarned || 0);
    if (pointsEarned > 0) {
      const alreadyEarned = await RewardTransaction.findOne({
        orderId: order._id,
        type: "earned",
      });

      if (!alreadyEarned) {
        currentBalance = currentBalance + pointsEarned;
        user.rewardPoints = currentBalance;
        await user.save();

        const isFirstOrderReward =
          pointsEarned >= 200 &&
          Math.abs(pointsEarned - Math.floor(Number(order.discountedTotalAmount || order.totalAmount || 0))) <= 1;
        const description = isFirstOrderReward
          ? `First Order 100% Cashback: Earned ${pointsEarned} points on Order #${order.orderNumber}`
          : `Earned from Order #${order.orderNumber} (₹${pointsEarned} value)`;

        await RewardTransaction.create({
          userId,
          type: "earned",
          points: pointsEarned,
          amount: pointsEarned * REWARD_CONFIG.RUPEES_PER_POINT,
          orderId: order._id,
          orderNumber: String(order.orderNumber || ""),
          description,
          balanceAfter: currentBalance,
        });
      }
    }
  }

  /**
   * Reverse rewards on order cancellation / refund.
   */
  static async reverseOrderRewardsOnCancel(order) {
    if (!order || !order.user) return;
    const userId = order.user._id || order.user;

    const user = await User.findById(userId);
    if (!user) return;

    let currentBalance = Math.max(0, Number(user.rewardPoints || 0));

    // 1. Restore redeemed points
    const pointsRedeemed = Number(order.rewardPointsRedeemed || 0);
    if (pointsRedeemed > 0) {
      const alreadyRefunded = await RewardTransaction.findOne({
        orderId: order._id,
        type: "refunded",
      });

      if (!alreadyRefunded) {
        currentBalance = currentBalance + pointsRedeemed;
        user.rewardPoints = currentBalance;
        await user.save();

        await RewardTransaction.create({
          userId,
          type: "refunded",
          points: pointsRedeemed,
          amount: pointsRedeemed * REWARD_CONFIG.RUPEES_PER_POINT,
          orderId: order._id,
          orderNumber: String(order.orderNumber || ""),
          description: `Refunded points from cancelled Order #${order.orderNumber}`,
          balanceAfter: currentBalance,
        });
      }
    }

    // 2. Revoke earned points if they were credited
    const pointsEarned = Number(order.rewardPointsEarned || 0);
    if (pointsEarned > 0) {
      const wasEarned = await RewardTransaction.findOne({
        orderId: order._id,
        type: "earned",
      });

      if (wasEarned) {
        const alreadyRevoked = await RewardTransaction.findOne({
          orderId: order._id,
          type: "adjusted",
        });

        if (!alreadyRevoked) {
          currentBalance = Math.max(0, currentBalance - pointsEarned);
          user.rewardPoints = currentBalance;
          await user.save();

          await RewardTransaction.create({
            userId,
            type: "adjusted",
            points: -pointsEarned,
            amount: pointsEarned * REWARD_CONFIG.RUPEES_PER_POINT,
            orderId: order._id,
            orderNumber: String(order.orderNumber || ""),
            description: `Revoked earned points from cancelled Order #${order.orderNumber}`,
            balanceAfter: currentBalance,
          });
        }
      }
    }
  }

  /**
   * Admin manually credits or adjusts reward points for a user.
   * Can be positive (credit) or negative (adjustment/debit).
   */
  static async adminAdjustUserPoints({ userId, points, reason, adminUser }) {
    if (!userId) {
      throw new Error("User ID is required");
    }
    const numPoints = Math.round(Number(points));
    if (isNaN(numPoints) || numPoints === 0) {
      throw new Error("Points must be a non-zero whole number");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const previousBalance = Math.max(0, Number(user.rewardPoints || 0));
    const newBalance = Math.max(0, previousBalance + numPoints);
    user.rewardPoints = newBalance;
    await user.save();

    const isCredit = numPoints > 0;
    const adminIdentifier = adminUser?.name || adminUser?.email || "Admin";
    const defaultReason = isCredit
      ? `Credited ${numPoints} reward points by Administrator (${adminIdentifier})`
      : `Deducted ${Math.abs(numPoints)} reward points by Administrator (${adminIdentifier})`;
    const description = reason && String(reason).trim()
      ? `${String(reason).trim()} (by Admin: ${adminIdentifier})`
      : defaultReason;

    const transaction = await RewardTransaction.create({
      userId: user._id,
      type: "adjusted",
      points: numPoints,
      amount: Math.abs(numPoints) * REWARD_CONFIG.RUPEES_PER_POINT,
      description,
      balanceAfter: newBalance,
    });

    return {
      user: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        rewardPoints: user.rewardPoints,
      },
      previousBalance,
      newBalance,
      pointsAdded: numPoints,
      transaction,
    };
  }
}

module.exports = {
  RewardService,
  REWARD_CONFIG,
};
