const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const FranchiseInventory = require("../../models/franchiseInventoryModel");
const StockDispatch = require("../../models/stockDispatchModel");
const FranchisePayment = require("../../models/franchisePaymentModel");
const CounterBill = require("../../models/counterBillModel");
const Franchise = require("../../models/franchiseModel");
const FranchiseLedgerService = require("../../services/franchiseLedger/index");

/**
 * Wholesale Stock Report
 */
const getWholesaleReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, franchiseId } = req.query;

  const match = { status: { $in: ["issued", "received", "partially_received"] } };
  if (franchiseId) match.franchise = franchiseId;
  if (startDate || endDate) {
    match.dispatched_date = {};
    if (startDate) match.dispatched_date.$gte = new Date(startDate);
    if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      match.dispatched_date.$lte = eDate;
    }
  }

  const dispatches = await StockDispatch.find(match)
    .populate("franchise", "name code phone address")
    .sort({ dispatched_date: -1 })
    .lean();

  const totalWholesaleValue = dispatches.reduce((sum, d) => sum + (Number(d.grand_total) || 0), 0);
  const totalDispatchedPieces = dispatches.reduce((sum, d) => sum + (Number(d.total_dispatched_quantity) || 0), 0);
  const totalReceivedPieces = dispatches.reduce((sum, d) => sum + (Number(d.total_received_quantity) || 0), 0);

  return res.status(200).json(
    new ApiResponse(200, {
      summary: {
        totalInvoices: dispatches.length,
        totalWholesaleValue: Number(totalWholesaleValue.toFixed(2)),
        totalDispatchedPieces,
        totalReceivedPieces,
      },
      dispatches,
    }, "Wholesale stock report fetched successfully.", true)
  );
});

/**
 * Khata Book Overview Report across all franchises
 */
const getKhataOverviewReport = asyncHandler(async (req, res) => {
  const franchises = await Franchise.find({ status: { $ne: "inactive" } }).select("name code phone address").lean();

  const franchiseKhatas = await Promise.all(
    franchises.map(async (f) => {
      try {
        const acc = await FranchiseLedgerService.getFranchiseAccountSummary(f._id);
        return acc;
      } catch (err) {
        return null;
      }
    })
  );

  const validKhatas = franchiseKhatas.filter(Boolean);

  const totalOutstanding = validKhatas.reduce((sum, k) => sum + (k.summary?.outstandingPayable || 0), 0);
  const totalStockSupplied = validKhatas.reduce((sum, k) => sum + (k.summary?.totalWholesaleStockValue || 0), 0);
  const totalOnlineSettlement = validKhatas.reduce((sum, k) => sum + (k.summary?.netOnlineSettlement || 0), 0);
  const totalPaymentsReceived = validKhatas.reduce((sum, k) => sum + (k.summary?.totalVerifiedPayments || 0), 0);
  const totalCommissionGiven = validKhatas.reduce((sum, k) => sum + (k.summary?.totalFranchiseCommissionEarned || 0), 0);

  return res.status(200).json(
    new ApiResponse(200, {
      summary: {
        totalFranchises: validKhatas.length,
        totalStockSupplied: Number(totalStockSupplied.toFixed(2)),
        totalOnlineSettlement: Number(totalOnlineSettlement.toFixed(2)),
        totalPaymentsReceived: Number(totalPaymentsReceived.toFixed(2)),
        totalCommissionGiven: Number(totalCommissionGiven.toFixed(2)),
        totalOutstanding: Number(totalOutstanding.toFixed(2)),
      },
      khatas: validKhatas,
    }, "Khata Book overview report fetched successfully.", true)
  );
});

/**
 * POS Customer Dues Report
 */
const getCustomerDuesReport = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const match = { due_amount: { $gt: 0 } };
  if (franchiseId) match.franchise = franchiseId;

  const dueBills = await CounterBill.find(match)
    .populate("franchise", "name code phone")
    .sort({ due_amount: -1, bill_date: -1 })
    .lean();

  const totalCustomerDue = dueBills.reduce((sum, b) => sum + (Number(b.due_amount) || 0), 0);
  const totalBilledValue = dueBills.reduce((sum, b) => sum + (Number(b.grand_total) || 0), 0);
  const totalCollectedValue = dueBills.reduce((sum, b) => sum + (Number(b.received_amount) || 0), 0);

  return res.status(200).json(
    new ApiResponse(200, {
      summary: {
        totalDueBills: dueBills.length,
        totalBilledValue: Number(totalBilledValue.toFixed(2)),
        totalCollectedValue: Number(totalCollectedValue.toFixed(2)),
        totalCustomerDue: Number(totalCustomerDue.toFixed(2)),
      },
      dueBills,
    }, "Customer dues report fetched successfully.", true)
  );
});

/**
 * Inventory Reconciliation Report
 * Formula: Closing Stock = Opening Stock + Stock Received - Online Sold - Walk-in Sold - Damaged Stock +/- Adjustments
 * Available Stock = Closing Stock - Reserved Stock
 */
const getInventoryReconciliationReport = asyncHandler(async (req, res) => {
  const franchiseId = req.scopedFranchiseId || req.query.franchiseId;
  const match = {};
  if (franchiseId) match.franchise = franchiseId;

  const inventory = await FranchiseInventory.find(match)
    .populate("franchise", "name code phone")
    .populate("product", "name sku price wholesale_price unit hsn image")
    .lean();

  const items = inventory.map((inv) => {
    const received = Number(inv.total_restocked_quantity || 0);
    const onlineSold = Number(inv.online_sold_quantity || 0);
    const manualSold = Number(inv.manual_sold_quantity || 0);
    const manualReduced = Number(inv.manual_reduced_quantity || 0);
    const onHand = Number(inv.quantity_on_hand || 0);
    const reserved = Number(inv.reserved_quantity || 0);
    const available = Math.max(0, onHand - reserved);

    return {
      _id: inv._id,
      franchise: inv.franchise,
      product: inv.product,
      sku: inv.sku,
      variant_sku: inv.variant_sku,
      stockReceived: received,
      onlineSold,
      walkInSold: manualSold,
      damagedWaste: manualReduced,
      closingStock: onHand,
      reservedStock: reserved,
      availableStock: available,
      unitPrice: Number(inv.product?.wholesale_price || inv.product?.price || 0),
      totalValueOnHand: Number((onHand * Number(inv.product?.wholesale_price || inv.product?.price || 0)).toFixed(2)),
    };
  });

  const totals = items.reduce(
    (acc, i) => {
      acc.totalClosingStock += i.closingStock;
      acc.totalReservedStock += i.reservedStock;
      acc.totalAvailableStock += i.availableStock;
      acc.totalInventoryValue += i.totalValueOnHand;
      acc.totalOnlineSold += i.onlineSold;
      acc.totalWalkInSold += i.walkInSold;
      return acc;
    },
    {
      totalItems: items.length,
      totalClosingStock: 0,
      totalReservedStock: 0,
      totalAvailableStock: 0,
      totalInventoryValue: 0,
      totalOnlineSold: 0,
      totalWalkInSold: 0,
    }
  );

  totals.totalInventoryValue = Number(totals.totalInventoryValue.toFixed(2));

  return res.status(200).json(
    new ApiResponse(200, {
      summary: totals,
      items,
    }, "Inventory reconciliation report fetched successfully.", true)
  );
});

module.exports = {
  getWholesaleReport,
  getKhataOverviewReport,
  getCustomerDuesReport,
  getInventoryReconciliationReport,
};
