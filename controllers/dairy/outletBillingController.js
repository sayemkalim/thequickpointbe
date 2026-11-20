const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const OutletBillingService = require("../../services/outletBilling/index");

/**
 * List Stock Challans
 */
const getChallans = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const { status, page, limit } = req.query;

  const result = await OutletBillingService.getChallans({
    franchiseId,
    status,
    page,
    limit,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Stock challans fetched successfully.", true)
  );
});

/**
 * Get live billing calculation (Challan - Online = Rest - Commission = Outlet Dega)
 */
const getLiveCalculation = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const { startDate, endDate, challanId, manualOfflineSalesAmount } = req.query;

  if (!franchiseId || franchiseId === "all") {
    return res.status(400).json(
      new ApiResponse(400, null, "Please specify a franchise store ID.", false)
    );
  }

  const result = await OutletBillingService.getLiveCalculation({
    franchiseId,
    startDate,
    endDate,
    challanId,
    manualOfflineSalesAmount,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Live billing calculation calculated successfully.", true)
  );
});

/**
 * 1-Click Generate Settlement Bill
 */
const generateBill = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.body.franchiseId;
  const { startDate, endDate, notes, challanId, manualOfflineSalesAmount } = req.body;

  if (!franchiseId || franchiseId === "all") {
    return res.status(400).json(
      new ApiResponse(400, null, "Please specify a franchise store ID.", false)
    );
  }

  const bill = await OutletBillingService.generateBill({
    franchiseId,
    startDate,
    endDate,
    challanId,
    notes,
    admin: req.admin,
    manualOfflineSalesAmount,
  });

  return res.status(201).json(
    new ApiResponse(201, bill, `Settlement Bill #${bill.billNumber} generated successfully!`, true)
  );
});

/**
 * Get Bills History
 */
const getBills = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const { page, limit } = req.query;

  const result = await OutletBillingService.getBills({
    franchiseId,
    page,
    limit,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Settlement bills fetched successfully.", true)
  );
});

/**
 * Record payment against a bill
 */
const recordPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount, paymentMethod, reference, notes } = req.body;

  const bill = await OutletBillingService.recordPayment({
    billId: id,
    amount,
    paymentMethod,
    reference,
    notes,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(200, bill, `Payment of ₹${amount} recorded for Bill #${bill.billNumber}.`, true)
  );
});

/**
 * Update Bill Payment Status & Outstanding Balance (Admin Mark Paid / Unpaid / Partial)
 */
const updateBillStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, amountPaid } = req.body;

  const bill = await OutletBillingService.updateBillStatus({
    billId: id,
    status,
    amountPaid,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      bill,
      `Bill #${bill.billNumber} status updated to ${bill.paymentStatus.toUpperCase()} (Paid: ₹${bill.amountPaid}, Due: ₹${bill.remainingAmount}).`,
      true
    )
  );
});

/**
 * Delete a specific settlement bill (Super Admin cleanup)
 */
const deleteBill = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await OutletBillingService.deleteBill({
    billId: id,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(200, result, result.message, true)
  );
});

/**
 * Reset all past test billing & challan data (Clean Slate)
 */
const resetData = asyncHandler(async (req, res) => {
  const franchiseId = req.query.franchiseId || req.body.franchiseId;

  const result = await OutletBillingService.resetAllData({
    franchiseId,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(200, result, result.message, true)
  );
});

module.exports = {
  getChallans,
  getLiveCalculation,
  generateBill,
  getBills,
  recordPayment,
  updateBillStatus,
  deleteBill,
  resetData,
};

