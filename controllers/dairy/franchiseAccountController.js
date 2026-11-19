const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const FranchiseLedgerService = require("../../services/franchiseLedger/index");
const Franchise = require("../../models/franchiseModel");

/**
 * Super Admin Global Summary across all franchises
 */
const getGlobalSummary = asyncHandler(async (req, res) => {
  const franchises = await Franchise.find({ status: { $ne: "inactive" } }).select("name code phone address").lean();

  const summaries = await Promise.all(
    franchises.map(async (f) => {
      try {
        const acc = await FranchiseLedgerService.getFranchiseAccountSummary(f._id);
        return acc;
      } catch (err) {
        return {
          franchise: f,
          summary: { outstandingPayable: 0, totalWholesaleStockValue: 0, totalVerifiedPayments: 0 },
        };
      }
    })
  );

  const totals = summaries.reduce(
    (acc, curr) => {
      acc.totalWholesaleStockSupplied += curr.summary?.totalWholesaleStockValue || 0;
      acc.totalOnlineSalesCollected += curr.summary?.totalOnlineSalesCollected || 0;
      acc.totalFranchiseCommissions += curr.summary?.totalFranchiseCommissionEarned || 0;
      acc.totalNetOnlineSettlement += curr.summary?.netOnlineSettlement || 0;
      acc.totalVerifiedPayments += curr.summary?.totalVerifiedPayments || 0;
      acc.totalPendingPayments += curr.summary?.pendingPayments || 0;
      acc.totalOutstandingPayable += curr.summary?.outstandingPayable || 0;
      acc.totalWalkInSales += curr.summary?.totalWalkInSales || 0;
      acc.totalCustomerDues += curr.summary?.totalCustomerDue || 0;
      return acc;
    },
    {
      totalFranchises: franchises.length,
      totalWholesaleStockSupplied: 0,
      totalOnlineSalesCollected: 0,
      totalFranchiseCommissions: 0,
      totalNetOnlineSettlement: 0,
      totalVerifiedPayments: 0,
      totalPendingPayments: 0,
      totalOutstandingPayable: 0,
      totalWalkInSales: 0,
      totalCustomerDues: 0,
    }
  );

  // Format numbers to 2 decimal places
  Object.keys(totals).forEach((key) => {
    if (typeof totals[key] === "number" && key !== "totalFranchises") {
      totals[key] = Number(totals[key].toFixed(2));
    }
  });

  return res.status(200).json(
    new ApiResponse(200, { totals, franchises: summaries }, "Global wholesale & franchise accounts summary fetched successfully.", true)
  );
});

/**
 * Get Franchise Account Summary
 */
const getFranchiseSummary = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;

  if (!franchiseId) {
    return res.status(400).json(
      new ApiResponse(400, null, "Franchise ID is required.", false)
    );
  }

  const summary = await FranchiseLedgerService.getFranchiseAccountSummary(franchiseId);

  return res.status(200).json(
    new ApiResponse(200, summary, "Franchise account summary fetched successfully.", true)
  );
});

/**
 * Get Franchise Ledger Statement (Khata Book)
 */
const getFranchiseStatement = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;
  const { startDate, endDate, transactionType, limit, page } = req.query;

  if (!franchiseId) {
    return res.status(400).json(
      new ApiResponse(400, null, "Franchise ID is required.", false)
    );
  }

  const statement = await FranchiseLedgerService.getFranchiseStatement({
    franchiseId,
    startDate,
    endDate,
    transactionType,
    limit,
    page,
  });

  return res.status(200).json(
    new ApiResponse(200, statement, "Franchise account statement fetched successfully.", true)
  );
});

/**
 * Post Manual Debit or Credit Adjustment (Super Admin / Central Admin)
 */
const postAdjustment = asyncHandler(async (req, res) => {
  const franchiseId = req.params.franchiseId;
  const { adjustmentType, amount, reason, referenceNo } = req.body;

  if (!["debit_adjustment", "credit_adjustment"].includes(adjustmentType)) {
    return res.status(400).json(
      new ApiResponse(400, null, "adjustmentType must be either 'debit_adjustment' or 'credit_adjustment'.", false)
    );
  }

  const entry = await FranchiseLedgerService.recordManualAdjustment({
    franchiseId,
    adjustmentType,
    amount,
    reason,
    referenceNo,
    admin: req.admin,
  });

  return res.status(201).json(
    new ApiResponse(201, entry, `Manual ${adjustmentType} of ₹${amount} posted to franchise ledger successfully.`, true)
  );
});

module.exports = {
  getGlobalSummary,
  getFranchiseSummary,
  getFranchiseStatement,
  postAdjustment,
};
