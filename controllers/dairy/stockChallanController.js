const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const StockChallanService = require("../../services/stockChallan/index");

/**
 * Create a new Stock Challan (Super Admin)
 */
const createChallan = asyncHandler(async (req, res) => {
  const { franchiseId, items, notes } = req.body;

  const challan = await StockChallanService.createChallan({
    franchiseId,
    items,
    notes,
    admin: req.admin,
  });

  return res.status(201).json(
    new ApiResponse(201, challan, `Stock Challan #${challan.challanNumber} issued successfully!`, true)
  );
});

/**
 * List Stock Challans with pagination & filters
 */
const getChallans = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const { status, startDate, endDate, search, page, limit } = req.query;

  const result = await StockChallanService.getChallans({
    franchiseId,
    status,
    startDate,
    endDate,
    search,
    page,
    limit,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Stock challans fetched successfully.", true)
  );
});

/**
 * Get details of a single Stock Challan
 */
const getChallanDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const challan = await StockChallanService.getChallanDetails(id);

  // Franchise isolation check
  if (req.admin.role === "franchise_owner") {
    if (String(req.admin.franchise) !== String(challan.franchise?._id || challan.franchise)) {
      return res.status(403).json(
        new ApiResponse(403, null, "Access denied: You can only view your own outlet's challans.", false)
      );
    }
  }

  return res.status(200).json(
    new ApiResponse(200, challan, "Stock challan details fetched successfully.", true)
  );
});

/**
 * Cancel a Stock Challan and revert stock
 */
const cancelChallan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const challan = await StockChallanService.cancelChallan({
    challanId: id,
    reason,
    admin: req.admin,
  });

  return res.status(200).json(
    new ApiResponse(200, challan, `Stock challan #${challan.challanNumber} cancelled successfully.`, true)
  );
});

module.exports = {
  createChallan,
  getChallans,
  getChallanDetails,
  cancelChallan,
};
