const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const FranchiseInventoryService = require("../../services/franchiseInventory/index");

/**
 * List inventory for an outlet
 * Scoped: Franchise Owner can only access their assigned outlet; Central Admin can access any.
 */
const getOutletInventory = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;
  const { page = 1, per_page = 50, search = "", filter = "all" } = req.query;

  if (!franchiseId) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Franchise ID is required", false));
  }

  const result = await FranchiseInventoryService.listByFranchise({
    franchiseId,
    page: parseInt(page, 10),
    per_page: parseInt(per_page, 10),
    search,
    filter,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Outlet inventory fetched successfully", true)
  );
});

/**
 * Restock an item in an outlet
 */
const restockItem = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.body.franchiseId;
  const { productId, variantSku, sku, quantity, lowStockThreshold } = req.body;

  if (!franchiseId || !productId || quantity === undefined) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "franchiseId, productId, and quantity are required", false));
  }

  try {
    const updated = await FranchiseInventoryService.restock({
      franchiseId,
      productId,
      variantSku,
      sku,
      quantity,
      lowStockThreshold,
      adminId: req.admin._id,
    });

    return res.status(200).json(
      new ApiResponse(200, updated, "Outlet inventory restocked successfully", true)
    );
  } catch (error) {
    return res.status(400).json(new ApiResponse(400, null, error.message, false));
  }
});

/**
 * Low stock alerts for an outlet
 */
const getLowStockAlerts = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;

  const result = await FranchiseInventoryService.listByFranchise({
    franchiseId,
    filter: "low_stock",
    page: 1,
    per_page: 100,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Low stock items fetched successfully", true)
  );
});

module.exports = {
  getOutletInventory,
  restockItem,
  getLowStockAlerts,
};
