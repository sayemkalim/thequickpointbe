const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const StoreSettings = require("../../models/storeSettingsModel");
const CommissionLedger = require("../../models/commissionLedgerModel");
const CommissionService = require("../../services/commission/index");

/**
 * Get Dairy Store Settings (Central Admin)
 */
const getStoreSettings = asyncHandler(async (req, res) => {
  let settings = await StoreSettings.findOne().lean();
  if (!settings) {
    settings = await StoreSettings.create({});
  }

  return res.status(200).json(
    new ApiResponse(200, settings, "Store settings fetched successfully", true)
  );
});

/**
 * Update Dairy Store Settings & Record Audit Log (Central Admin)
 */
const updateStoreSettings = asyncHandler(async (req, res) => {
  let settings = await StoreSettings.findOne();
  if (!settings) {
    settings = await StoreSettings.create({});
  }

  const {
    defaultRadiusKm,
    commission,
    paymentGateways,
    smsSettings,
    auditNote,
  } = req.body;

  const previousState = {
    defaultRadiusKm: settings.defaultRadiusKm,
    commission: settings.commission,
    paymentGateways: settings.paymentGateways,
  };

  if (defaultRadiusKm !== undefined) {
    settings.defaultRadiusKm = Number(defaultRadiusKm);
  }

  if (commission !== undefined) {
    if (commission.type) settings.commission.type = commission.type;
    if (commission.value !== undefined) settings.commission.value = Number(commission.value);
    if (commission.payoutCycle) settings.commission.payoutCycle = commission.payoutCycle;

    // Record audit log for commission rule change
    settings.auditLogs.push({
      changedBy: req.admin._id,
      changeType: "global_commission",
      previousSetting: previousState.commission,
      newSetting: settings.commission,
      note: auditNote || "Global dairy commission rules modified by central admin",
      ipAddress: req.ip,
    });
  }

  if (paymentGateways !== undefined) {
    if (paymentGateways.razorpay) {
      settings.paymentGateways.razorpay = paymentGateways.razorpay;
    }
    if (paymentGateways.cashfree) {
      settings.paymentGateways.cashfree = paymentGateways.cashfree;
    }
  }

  if (smsSettings !== undefined) {
    settings.smsSettings = { ...settings.smsSettings, ...smsSettings };
  }

  await settings.save();

  return res.status(200).json(
    new ApiResponse(200, settings, "Store settings updated successfully", true)
  );
});

/**
 * Get Commission Ledger & Earnings Reports
 * Scoped: Franchise Owner sees only their own outlet's earnings; Central Admin sees all.
 */
const getCommissionLedger = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const { status, page = 1, per_page = 50, startDate, endDate } = req.query;

  const query = {};
  if (franchiseId) query.franchise = franchiseId;
  if (status) query.status = status;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const skip = (Math.max(1, page) - 1) * per_page;

  const [records, total] = await Promise.all([
    CommissionLedger.find(query)
      .populate("franchise", "name code")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(per_page))
      .lean(),
    CommissionLedger.countDocuments(query),
  ]);

  // Aggregate totals
  const totals = records.reduce(
    (acc, curr) => {
      acc.totalOutletEarnings += Number(curr.outletCommissionAmount || 0);
      acc.totalPlatformEarnings += Number(curr.platformCommissionAmount || 0);
      return acc;
    },
    { totalOutletEarnings: 0, totalPlatformEarnings: 0 }
  );

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        records,
        total,
        page: Number(page),
        per_page: Number(per_page),
        total_pages: Math.ceil(total / per_page),
        totals: {
          totalOutletEarnings: Number(totals.totalOutletEarnings.toFixed(2)),
          totalPlatformEarnings: Number(totals.totalPlatformEarnings.toFixed(2)),
        },
      },
      "Commission ledger records fetched successfully",
      true
    )
  );
});

/**
 * Central Admin marks commission payout
 */
const markPayout = asyncHandler(async (req, res) => {
  const { ledgerIds, payoutReference } = req.body;

  if (!ledgerIds || !Array.isArray(ledgerIds) || ledgerIds.length === 0) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "ledgerIds array is required", false));
  }

  const updateResult = await CommissionLedger.updateMany(
    { _id: { $in: ledgerIds }, status: "accrued" },
    {
      $set: {
        status: "paid",
        payoutReference: payoutReference || `PAYOUT_${Date.now()}`,
        payoutDate: new Date(),
      },
    }
  );

  return res.status(200).json(
    new ApiResponse(200, updateResult, `Payout processed for ${updateResult.modifiedCount} records`, true)
  );
});

module.exports = {
  getStoreSettings,
  updateStoreSettings,
  getCommissionLedger,
  markPayout,
};
