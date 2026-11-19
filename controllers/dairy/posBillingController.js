const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const PosBillingService = require("../../services/posBilling/index");

/**
 * Create a new Walk-in Counter POS Bill
 */
const createPosBill = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.body.franchiseId;
  const { customerName, customerPhone, items, discountAmount, receivedAmount, paymentMethod, notes } = req.body;

  const bill = await PosBillingService.createPosBill({
    franchiseId,
    customerName,
    customerPhone,
    items,
    discountAmount,
    receivedAmount,
    paymentMethod,
    notes,
    admin: req.admin,
  });

  return res.status(201).json(
    new ApiResponse(201, bill, `Walk-in POS bill #${bill.bill_number} generated successfully!`, true)
  );
});

/**
 * List Walk-in POS Bills
 */
const getPosBills = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const { paymentStatus, customerPhone, startDate, endDate, search, limit, page } = req.query;

  const result = await PosBillingService.getPosBills({
    franchiseId,
    paymentStatus,
    customerPhone,
    startDate,
    endDate,
    search,
    limit,
    page,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "POS bills fetched successfully.", true)
  );
});

/**
 * Get details of a single POS Bill
 */
const getPosBillDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const bill = await PosBillingService.getPosBillDetails(id);

  if (req.admin.role === "franchise_owner") {
    if (String(req.admin.franchise) !== String(bill.franchise?._id || bill.franchise)) {
      return res.status(403).json(
        new ApiResponse(403, null, "Access denied: You are only authorized to view bills for your own outlet.", false)
      );
    }
  }

  return res.status(200).json(
    new ApiResponse(200, bill, "POS bill details fetched successfully.", true)
  );
});

/**
 * Collect Customer Due Payment against an existing bill
 */
const collectCustomerDuePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount, paymentMethod, transactionReference, notes } = req.body;

  const bill = await PosBillingService.collectCustomerDuePayment({
    billId: id,
    amount,
    paymentMethod,
    transactionReference,
    notes,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(200, bill, `Payment of ₹${amount} collected against bill #${bill.bill_number}. Remaining customer due: ₹${bill.due_amount}.`, true)
  );
});

module.exports = {
  createPosBill,
  getPosBills,
  getPosBillDetails,
  collectCustomerDuePayment,
};
