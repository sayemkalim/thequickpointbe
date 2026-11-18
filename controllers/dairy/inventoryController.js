const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const FranchiseInventoryService = require("../../services/franchiseInventory/index");
const FranchiseInvoice = require("../../models/franchiseInvoiceModel");
const FranchiseStockTransfer = require("../../models/franchiseStockTransferModel");

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
 * Restricted strictly to Super Admin & Admin ONLY
 */
const restockItem = asyncHandler(async (req, res) => {
  if (req.admin.role === "franchise_owner") {
    return res.status(403).json(
      new ApiResponse(403, null, "Franchise owners cannot restock outlet inventory. Only Super Admin and Admin are permitted.", false)
    );
  }

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
  const { page = 1, per_page = 50, productId, type } = req.query;

  const result = await FranchiseInventoryService.getLogs({
    franchiseId,
    productId,
    page: parseInt(page, 10),
    per_page: parseInt(per_page, 10),
    type,
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


/**
 * Create a multi-item stock transfer / dispatch with a Challan
 */
const createStockTransfer = asyncHandler(async (req, res) => {
  if (req.admin.role === "franchise_owner") {
    return res.status(403).json(
      new ApiResponse(403, null, "Franchise owners cannot dispatch stock.", false)
    );
  }

  const { franchiseId, items, challanNo, notes } = req.body;
  if (!franchiseId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json(
      new ApiResponse(400, null, "franchiseId and items array are required.", false)
    );
  }

  const autoChallan = challanNo || `CH-${Date.now().toString().slice(-6)}`;

  const transferItems = [];
  let totalQty = 0;

  for (const it of items) {
    const qty = Number(it.quantity);
    if (qty > 0 && it.productId) {
      await FranchiseInventoryService.restock({
        franchiseId,
        productId: it.productId,
        variantSku: it.variantSku || null,
        sku: it.sku || "",
        quantity: qty,
        adminId: req.admin._id,
      });

      transferItems.push({
        product: it.productId,
        name: it.name || it.productName || "Product",
        sku: it.sku || "",
        unit: it.unit || "pcs",
        quantity: qty,
        price: Number(it.price || 0),
      });

      totalQty += qty;
    }
  }

  const transfer = await FranchiseStockTransfer.create({
    challan_no: autoChallan,
    franchise: franchiseId,
    date: new Date(),
    items: transferItems,
    total_quantity: totalQty,
    total_items: transferItems.length,
    status: "dispatched",
    dispatched_by: req.admin._id,
    dispatched_by_name: req.admin.name || "Admin",
    notes: notes || "",
  });

  return res.status(201).json(
    new ApiResponse(201, transfer, `Stock transfer ${autoChallan} created successfully!`, true)
  );
});

/**
 * Get all stock transfers (challans) for a franchise
 */
const getStockTransfers = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;
  const transfers = await FranchiseStockTransfer.find({ franchise: franchiseId })
    .populate("items.product", "name sku price discounted_price unit")
    .sort({ createdAt: -1 })
    .lean();

  return res.status(200).json(
    new ApiResponse(200, transfers, "Stock transfers fetched successfully", true)
  );
});

/**
 * Save a finalized Franchise Tax Invoice (New Bill)
 */
const saveFranchiseInvoice = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;
  const {
    invoiceNo,
    date,
    items,
    totalQuantity,
    subTotal,
    discountAmount,
    totalAmount,
    paymentType = "Credit",
    paymentStatus = "unpaid",
    previousDue = 0,
    netTotalDue,
    receivedAmount = 0,
    balanceDue = 0,
    notes = "",
  } = req.body;

  if (!franchiseId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json(
      new ApiResponse(400, null, "Franchise ID and items are required.", false)
    );
  }

  const autoInvoiceNo = invoiceNo || `${Math.floor(1000 + Math.random() * 9000)}`;

  const invoice = await FranchiseInvoice.create({
    invoice_no: autoInvoiceNo,
    franchise: franchiseId,
    date: date ? new Date(date) : new Date(),
    items: items.map((it) => ({
      product: it.productId || it.product?._id || it.product,
      name: it.name,
      sku: it.sku || "",
      unit: it.unit || "pcs",
      hsn: it.hsn || "",
      quantity: Number(it.quantity) || 0,
      price_per_unit: Number(it.pricePerUnit || it.price) || 0,
      discount_percent: Number(it.discountPercent) || 0,
      discount_amount: Number(it.discountAmount || it.totalDiscount) || 0,
      total_amount: Number(it.totalAmount || it.lineAmount) || 0,
    })),
    total_quantity: Number(totalQuantity) || 0,
    sub_total: Number(subTotal) || 0,
    discount_amount: Number(discountAmount) || 0,
    total_amount: Number(totalAmount) || 0,
    payment_type: paymentType,
    payment_status: paymentStatus,
    received_amount: Number(receivedAmount) || 0,
    balance_due: Number(balanceDue) || 0,
    previous_due: Number(previousDue) || 0,
    net_total_due: Number(netTotalDue !== undefined ? netTotalDue : (Number(totalAmount) + Number(previousDue) - Number(receivedAmount))) || 0,
    notes,
    created_by_admin: req.admin?._id || null,
    created_by_name: req.admin?.name || "Admin",
  });

  return res.status(201).json(
    new ApiResponse(201, invoice, `Invoice #${autoInvoiceNo} saved successfully!`, true)
  );
});

/**
 * Get all saved invoices for a franchise
 */
const getFranchiseInvoices = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.params.franchiseId;
  const invoices = await FranchiseInvoice.find({ franchise: franchiseId })
    .populate("items.product", "name sku price discounted_price unit")
    .sort({ createdAt: -1 })
    .lean();

  return res.status(200).json(
    new ApiResponse(200, invoices, "Franchise invoices fetched successfully", true)
  );
});

module.exports = {
  getOutletInventory,
  restockItem,
  getLowStockAlerts,
  reduceStock,
  getInventoryLogs,
  getDailySummary,
  createStockTransfer,
  getStockTransfers,
  saveFranchiseInvoice,
  getFranchiseInvoices,
};

