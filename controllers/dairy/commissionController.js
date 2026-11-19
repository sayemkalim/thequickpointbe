const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const Franchise = require("../../models/franchiseModel");
const CommissionLedger = require("../../models/commissionLedgerModel");
const CommissionService = require("../../services/commission/index");

/**
 * Get Franchise Commission Configuration & Snapshot History
 */
const getCommissionConfig = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;
  const franchise = await Franchise.findById(franchiseId).select("name code commissionOverride").lean();

  if (!franchise) {
    return res.status(404).json(
      new ApiResponse(404, null, "Franchise not found.", false)
    );
  }

  return res.status(200).json(
    new ApiResponse(200, {
      franchiseId: franchise._id,
      name: franchise.name,
      code: franchise.code,
      commissionConfig: franchise.commissionOverride || {
        enabled: true,
        type: "percentage",
        value: 10,
        scope: "online_only",
        calculationBasis: "order_total",
      },
    }, "Franchise commission configuration fetched successfully.", true)
  );
});

/**
 * Configure Franchise Commission (Super Admin ONLY)
 * Creates historical snapshot without affecting historical orders
 */
const updateCommissionConfig = asyncHandler(async (req, res) => {
  const franchiseId = req.params.franchiseId;
  const { enabled, type, value, scope, calculationBasis, effectiveFrom, note } = req.body;

  const franchise = await Franchise.findById(franchiseId);
  if (!franchise) {
    return res.status(404).json(
      new ApiResponse(404, null, "Franchise not found.", false)
    );
  }

  const previousSetting = franchise.commissionOverride ? { ...franchise.commissionOverride.toObject?.() || franchise.commissionOverride } : null;

  // Initialize history array if not present
  if (!franchise.commissionOverride) {
    franchise.commissionOverride = {};
  }
  if (!Array.isArray(franchise.commissionOverride.history)) {
    franchise.commissionOverride.history = [];
  }

  // Record historical snapshot of previous configuration if it existed
  if (previousSetting && previousSetting.value !== undefined) {
    franchise.commissionOverride.history.push({
      type: previousSetting.type || "percentage",
      value: previousSetting.value,
      scope: previousSetting.scope || "online_only",
      calculationBasis: previousSetting.calculationBasis || "order_total",
      effectiveFrom: previousSetting.effectiveFrom || franchise.updatedAt || new Date(),
      updatedBy: req.admin._id,
      updatedAt: new Date(),
    });
  }

  // Apply new settings
  if (enabled !== undefined) franchise.commissionOverride.enabled = Boolean(enabled);
  if (type) franchise.commissionOverride.type = type;
  if (value !== undefined) franchise.commissionOverride.value = Math.max(0, Number(value));
  if (scope) franchise.commissionOverride.scope = scope;
  if (calculationBasis) franchise.commissionOverride.calculationBasis = calculationBasis;
  franchise.commissionOverride.effectiveFrom = effectiveFrom ? new Date(effectiveFrom) : new Date();

  await franchise.save();

  // Audit log
  try {
    await CommissionService.logCommissionChange({
      changedBy: req.admin._id,
      franchiseId: franchise._id,
      changeType: "franchise_commission_override",
      previousSetting,
      newSetting: franchise.commissionOverride,
      note: note || `Updated commission to ${franchise.commissionOverride.value}% (${franchise.commissionOverride.scope})`,
      ipAddress: req.ip,
    });
  } catch (logErr) {
    console.error("Audit log error:", logErr.message);
  }

  return res.status(200).json(
    new ApiResponse(200, franchise.commissionOverride, `Commission for ${franchise.name} updated to ${franchise.commissionOverride.value}% successfully.`, true)
  );
});

/**
 * Get Commission Earnings History for a Franchise
 */
const getCommissionLogs = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;
  const { startDate, endDate, limit = 50, page = 1 } = req.query;

  const match = { franchise: franchiseId };
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      match.createdAt.$lte = eDate;
    }
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [logs, totalCount] = await Promise.all([
    CommissionLedger.find(match)
      .populate("order", "orderNumber totalAmount paymentMethod status createdAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    CommissionLedger.countDocuments(match),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      logs,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(totalCount / Number(limit)),
      },
    }, "Commission logs fetched successfully.", true)
  );
});

module.exports = {
  getCommissionConfig,
  updateCommissionConfig,
  getCommissionLogs,
};

