const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const StockDispatchService = require("../../services/stockDispatch/index");

/**
 * Create Wholesale Stock Dispatch Invoice (Super Admin / Central Admin)
 */
const createDispatchInvoice = asyncHandler(async (req, res) => {
  const { franchiseId, items, discountAmount, notes, status } = req.body;

  const dispatch = await StockDispatchService.createDispatchInvoice({
    franchiseId,
    items,
    discountAmount,
    notes,
    status,
    admin: req.admin,
  });

  return res.status(201).json(
    new ApiResponse(201, dispatch, `Wholesale stock dispatch invoice #${dispatch.invoice_no} issued successfully!`, true)
  );
});

/**
 * List Stock Dispatch Invoices with filters and pagination
 */
const getDispatchInvoices = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const { status, startDate, endDate, search, limit, page } = req.query;

  const result = await StockDispatchService.getDispatchInvoices({
    franchiseId,
    status,
    startDate,
    endDate,
    search,
    limit,
    page,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Stock dispatch invoices fetched successfully.", true)
  );
});

/**
 * Get details of a single Stock Dispatch Invoice
 */
const getDispatchDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const dispatch = await StockDispatchService.getDispatchDetails(id);

  // Franchise isolation check
  if (req.admin.role === "franchise_owner") {
    if (String(req.admin.franchise) !== String(dispatch.franchise?._id || dispatch.franchise)) {
      return res.status(403).json(
        new ApiResponse(403, null, "Access denied: You are only authorized to view your own outlet's dispatches.", false)
      );
    }
  }

  return res.status(200).json(
    new ApiResponse(200, dispatch, "Stock dispatch invoice details fetched successfully.", true)
  );
});

/**
 * Confirm Stock Receipt at Franchise Outlet (Full or Partial with discrepancies)
 */
const confirmStockReceipt = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { receivedItems, notes } = req.body;

  const result = await StockDispatchService.confirmStockReceipt({
    dispatchId: id,
    receivedItems: receivedItems || [],
    notes,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Stock receipt confirmed successfully. Inventory restocked and wholesale debit posted to ledger.", true)
  );
});

/**
 * Cancel a Stock Dispatch Invoice
 */
const cancelDispatchInvoice = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const dispatch = await StockDispatchService.cancelDispatchInvoice({
    dispatchId: id,
    reason,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(200, dispatch, `Dispatch invoice #${dispatch.invoice_no} cancelled successfully.`, true)
  );
});

module.exports = {
  createDispatchInvoice,
  getDispatchInvoices,
  getDispatchDetails,
  confirmStockReceipt,
  cancelDispatchInvoice,
};
