const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const SettlementService = require("../../services/settlement/index");

/**
 * Preview un-settled sales, commission, and net payable before confirming
 */
const previewSettlement = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId || req.body.franchiseId;
  const { startDate, endDate } = req.query;

  const preview = await SettlementService.previewSettlement({
    franchiseId,
    startDate,
    endDate,
  });

  return res.status(200).json(
    new ApiResponse(200, preview, "Settlement preview calculated successfully.", true)
  );
});

/**
 * Confirm and generate immutable settlement
 */
const confirmSettlement = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.body.franchiseId;
  const { startDate, endDate, notes } = req.body;

  const settlement = await SettlementService.confirmSettlement({
    franchiseId,
    startDate,
    endDate,
    notes,
    admin: req.admin,
  });

  return res.status(201).json(
    new ApiResponse(201, settlement, `Settlement #${settlement.settlementNumber} confirmed successfully!`, true)
  );
});

/**
 * Record payment received against a settlement
 */
const recordSettlementPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount, paymentMethod, reference, notes } = req.body;

  const settlement = await SettlementService.recordSettlementPayment({
    settlementId: id,
    amount,
    paymentMethod,
    reference,
    notes,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      settlement,
      `Payment of ₹${amount} recorded against settlement #${settlement.settlementNumber}. Remaining: ₹${settlement.remainingAmount}.`,
      true
    )
  );
});

/**
 * List settlements
 */
const getSettlements = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const { paymentStatus, page, limit } = req.query;

  const result = await SettlementService.getSettlements({
    franchiseId,
    paymentStatus,
    page,
    limit,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Settlements fetched successfully.", true)
  );
});

/**
 * Get details of a single settlement
 */
const getSettlementDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const settlement = await SettlementService.getSettlementDetails(id);

  if (req.admin.role === "franchise_owner") {
    if (String(req.admin.franchise) !== String(settlement.franchise?._id || settlement.franchise)) {
      return res.status(403).json(
        new ApiResponse(403, null, "Access denied: You can only view your own outlet's settlements.", false)
      );
    }
  }

  return res.status(200).json(
    new ApiResponse(200, settlement, "Settlement details fetched successfully.", true)
  );
});

/**
 * Sales summary (Online vs Walk-in) for Franchise Details view
 */
const getFranchiseSalesSummary = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.id;
  const { startDate, endDate } = req.query;

  const summary = await SettlementService.getFranchiseSalesSummary({
    franchiseId,
    startDate,
    endDate,
  });

  return res.status(200).json(
    new ApiResponse(200, summary, "Franchise sales summary fetched successfully.", true)
  );
});

/**
 * Stock summary for Franchise Details view
 */
const getFranchiseStockSummary = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.id;

  const summary = await SettlementService.getFranchiseStockSummary({
    franchiseId,
  });

  return res.status(200).json(
    new ApiResponse(200, summary, "Franchise stock summary fetched successfully.", true)
  );
});

module.exports = {
  previewSettlement,
  confirmSettlement,
  recordSettlementPayment,
  getSettlements,
  getSettlementDetails,
  getFranchiseSalesSummary,
  getFranchiseStockSummary,
};

