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
 * Restock an item (or batch of items) in an outlet
 * Restricted strictly to Super Admin & Admin ONLY
 * Automatically creates a Stock Challan for every restock dispatch
 */
const restockItem = asyncHandler(async (req, res) => {
  if (req.admin.role === "franchise_owner") {
    return res.status(403).json(
      new ApiResponse(403, null, "Franchise owners cannot restock outlet inventory. Only Super Admin and Admin are permitted.", false)
    );
  }

  const franchiseId = req.scopedFranchiseId || req.body.franchiseId;
  const { productId, variantSku, sku, quantity, lowStockThreshold, items, notes } = req.body;

  if (!franchiseId) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "franchiseId is required", false));
  }

  let restockList = [];
  if (Array.isArray(items) && items.length > 0) {
    restockList = items;
  } else if (productId && quantity !== undefined) {
    restockList = [{ productId, variantSku, sku, quantity, lowStockThreshold }];
  } else {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Either items array or productId and quantity are required", false));
  }

  try {
    const OutletBillingService = require("../../services/outletBilling/index");
    const updatedItems = [];
    const challanItems = [];

    for (const item of restockList) {
      const pId = item.productId || item.product;
      const q = Number(item.quantity);
      if (!pId || isNaN(q) || q <= 0) continue;

      const updated = await FranchiseInventoryService.restock({
        franchiseId,
        productId: pId,
        variantSku: item.variantSku || null,
        sku: item.sku,
        quantity: q,
        lowStockThreshold: item.lowStockThreshold,
        adminId: req.admin._id,
      });

      updatedItems.push(updated);
      challanItems.push({
        product: pId,
        quantity: q,
        sku: item.sku,
        price: item.price,
      });
    }

    let challan = null;
    if (challanItems.length > 0) {
      try {
        challan = await OutletBillingService.createChallan({
          franchiseId,
          items: challanItems,
          notes: notes || "Restock dispatch consignment credit",
          admin: req.admin,
        });
      } catch (chErr) {
        console.error("Auto challan creation error:", chErr.message);
      }
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          items: updatedItems,
          challan,
        },
        challan
          ? `Outlet restocked successfully. Stock Challan #${challan.challanNumber} issued.`
          : "Outlet inventory restocked successfully",
        true
      )
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

/**
 * Reduce stock / Record manual offline counter sale for an outlet
 * Allowed for Franchise Owners (scoped to their outlet) and Super Admin / Admin
 */
const reduceStock = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.body.franchiseId;
  const {
    productId,
    variantSku,
    sku,
    quantity,
    type = "counter_sale",
    reason = "",
    customerName,
    customerMobile,
    unitPrice,
    totalAmount,
    receivedAmount,
    dueAmount,
    paymentMethod,
    billNo,
    batchId,
  } = req.body;

  if (!franchiseId || !productId || quantity === undefined) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "franchiseId, productId, and quantity are required", false));
  }

  try {
    const result = await FranchiseInventoryService.reduceStock({
      franchiseId,
      productId,
      variantSku,
      sku,
      quantity,
      type,
      reason,
      customerName,
      customerMobile,
      unitPrice,
      totalAmount,
      receivedAmount,
      dueAmount,
      paymentMethod,
      billNo,
      batchId,
      adminId: req.admin._id,
      adminName: req.admin.name || "Staff",
      adminRole: req.admin.role,
    });

    const msg =
      type === "counter_sale"
        ? "Offline counter sale recorded successfully."
        : "Outlet stock reduced successfully.";

    return res.status(200).json(new ApiResponse(200, result, msg, true));
  } catch (error) {
    return res.status(400).json(new ApiResponse(400, null, error.message, false));
  }
});

/**
 * Get stock adjustment & offline sales logs for an outlet
 */
const getInventoryLogs = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;
  const { page = 1, per_page = 50, productId, type, startDate, endDate, from, to } = req.query;

  const result = await FranchiseInventoryService.getLogs({
    franchiseId,
    productId,
    page: parseInt(page, 10),
    per_page: parseInt(per_page, 10),
    type,
    startDate: startDate || from || null,
    endDate: endDate || to || null,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Outlet stock logs fetched successfully", true)
  );
});


/**
 * Get daily sales and stock settlement summary
 */
const getDailySummary = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;
  const { date } = req.query;

  const result = await FranchiseInventoryService.getDailySummary({
    franchiseId,
    date,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Daily summary fetched successfully", true)
  );
});

const getDateWiseSales = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;
  const { startDate, endDate, date, from, to } = req.query;

  const result = await FranchiseInventoryService.getDateWiseSales({
    franchiseId,
    startDate: startDate || from || null,
    endDate: endDate || to || null,
    date: date || null,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Date-wise sales fetched successfully", true)
  );
});

module.exports = {
  getDateWiseSales,
  getOutletInventory,
  restockItem,
  getLowStockAlerts,
  reduceStock,
  getInventoryLogs,
  getDailySummary,
};
