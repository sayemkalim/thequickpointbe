const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const FranchisePaymentService = require("../../services/franchisePayment/index");

/**
 * Submit Franchise Payment to Company
 */
const submitPayment = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.body.franchiseId;
  const { amount, paymentMethod, transactionReference, proofUrl, notes, paymentDate } = req.body;

  const payment = await FranchisePaymentService.submitPayment({
    franchiseId,
    amount,
    paymentMethod,
    transactionReference,
    proofUrl,
    notes,
    paymentDate,
    admin: req.admin,
  });

  return res.status(201).json(
    new ApiResponse(201, payment, `Payment submission #${payment.payment_number} of ₹${payment.amount} recorded. Awaiting central verification.`, true)
  );
});

/**
 * List Franchise Payments
 */
const getPayments = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const { status, paymentMethod, startDate, endDate, search, limit, page } = req.query;

  const result = await FranchisePaymentService.getPayments({
    franchiseId,
    status,
    paymentMethod,
    startDate,
    endDate,
    search,
    limit,
    page,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Franchise payments fetched successfully.", true)
  );
});

/**
 * Get details of a single Payment
 */
const getPaymentDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payment = await FranchisePaymentService.getPaymentDetails(id);

  if (req.admin.role === "franchise_owner") {
    if (String(req.admin.franchise) !== String(payment.franchise?._id || payment.franchise)) {
      return res.status(403).json(
        new ApiResponse(403, null, "Access denied: You are only authorized to view payments for your own outlet.", false)
      );
    }
  }

  return res.status(200).json(
    new ApiResponse(200, payment, "Payment details fetched successfully.", true)
  );
});

/**
 * Verify a Franchise Payment (Central Admin ONLY)
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await FranchisePaymentService.verifyPayment({
    paymentId: id,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(200, result, `Payment #${result.payment.payment_number} verified successfully. Credited ₹${result.payment.amount} to franchise Khata Book!`, true)
  );
});

/**
 * Reject a Franchise Payment (Central Admin ONLY)
 */
const rejectPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rejectionReason } = req.body;

  const payment = await FranchisePaymentService.rejectPayment({
    paymentId: id,
    rejectionReason,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(200, payment, `Payment #${payment.payment_number} rejected.`, true)
  );
});

module.exports = {
  submitPayment,
  getPayments,
  getPaymentDetails,
  verifyPayment,
  rejectPayment,
};
