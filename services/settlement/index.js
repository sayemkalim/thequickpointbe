const mongoose = require("mongoose");
const FranchiseSettlement = require("../../models/franchiseSettlementModel");
const StockChallan = require("../../models/stockChallanModel");
const CounterBill = require("../../models/counterBillModel");
const OutletStockLog = require("../../models/outletStockLogModel");
const Order = require("../../models/orderModel");
const Franchise = require("../../models/franchiseModel");
const FranchiseInventory = require("../../models/franchiseInventoryModel");

class FranchiseSettlementService {
  /**
   * Preview Settlement for a Franchise (Calculates un-settled walk-in & online sales, stock, and payable)
   */
  async previewSettlement({ franchiseId, startDate, endDate }) {
    if (!franchiseId) {
      throw new Error("Franchise ID is required.");
    }

    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) {
      throw new Error("Franchise not found.");
    }

    // Determine period:
    // If startDate not provided, default to latest confirmed settlement periodEnd or 30 days ago
    let periodStart;
    if (startDate) {
      periodStart = new Date(startDate);
    } else {
      const latestSettlement = await FranchiseSettlement.findOne({
        franchise: franchise._id,
        status: "confirmed",
      })
        .sort({ confirmedAt: -1 })
        .lean();

      if (latestSettlement && latestSettlement.periodEnd) {
        periodStart = new Date(latestSettlement.periodEnd);
      } else {
        periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      }
    }

    let periodEnd = new Date();
    if (endDate) {
      periodEnd = new Date(endDate);
      if (typeof endDate === "string" && endDate.length === 10) {
        periodEnd.setHours(23, 59, 59, 999);
      }
    }

    // 1. Fetch un-settled Walk-in Counter Bills & Offline Stock Sales in this period
    const walkInBills = await CounterBill.find({
      franchise: franchise._id,
      isSettled: false,
      createdAt: { $gte: periodStart, $lte: periodEnd },
    }).lean();

    const rawOfflineStockLogs = await OutletStockLog.find({
      franchise: franchise._id,
      type: "counter_sale",
      is_settled: { $ne: true },
      createdAt: { $gte: periodStart, $lte: periodEnd },
    }).lean();

    // Prevent double counting if both CounterBill and OutletStockLog exist for the same bill
    const counterBillNumbers = new Set(walkInBills.map((b) => b.bill_number).filter(Boolean));
    const offlineStockLogs = rawOfflineStockLogs.filter(
      (log) => !log.bill_no || !counterBillNumbers.has(log.bill_no)
    );

    let walkInGrossAmount = 0;
    let walkInTotalQuantity = 0;
    const walkInProductQtyMap = {};

    walkInBills.forEach((bill) => {
      walkInGrossAmount += Number(bill.grand_total || 0);
      (bill.items || []).forEach((item) => {
        const pId = String(item.product?._id || item.product);
        const qty = Number(item.quantity || 0);
        walkInTotalQuantity += qty;
        walkInProductQtyMap[pId] = (walkInProductQtyMap[pId] || 0) + qty;
      });
    });

    offlineStockLogs.forEach((log) => {
      const amt = Number(log.total_amount || (log.quantity * (log.unit_price || 0)));
      walkInGrossAmount += amt;
      const pId = String(log.product?._id || log.product);
      const qty = Number(log.quantity || 0);
      walkInTotalQuantity += qty;
      walkInProductQtyMap[pId] = (walkInProductQtyMap[pId] || 0) + qty;
    });

    // 2. Fetch Online Orders (Cashfree verified & completed) for this franchise
    const onlineOrders = await Order.find({
      franchise: franchise._id,
      paymentStatus: "completed",
      status: { $nin: ["cancelled", "refunded"] },
      createdAt: { $gte: periodStart, $lte: periodEnd },
    }).lean();

    let onlineGrossAmount = 0;
    let onlineTotalQuantity = 0;
    const onlineProductQtyMap = {};

    onlineOrders.forEach((ord) => {
      onlineGrossAmount += Number(ord.totalAmount || 0);
      (ord.items || []).forEach((item) => {
        const pId = String(item.product?._id || item.product);
        const qty = Number(item.quantity || 1);
        onlineTotalQuantity += qty;
        onlineProductQtyMap[pId] = (onlineProductQtyMap[pId] || 0) + qty;
      });
    });

    // 3. Fetch Outlet Inventories to map product prices & calculate stock
    const inventories = await FranchiseInventory.find({ franchise: franchise._id })
      .populate("product", "name sku unit price discounted_price")
      .lean();

    const productPriceMap = {};
    inventories.forEach((inv) => {
      const pId = String(inv.product?._id || inv.product);
      productPriceMap[pId] = Number(inv.product?.discounted_price || inv.product?.price || 0);
    });

    // 4. Fetch Stock Dispatches (Challans) in this period
    const challans = await StockChallan.find({
      franchise: franchise._id,
      status: { $in: ["dispatched", "received"] },
      dispatchDate: { $gte: periodStart, $lte: periodEnd },
    }).lean();

    const challanProductQtyMap = {};
    let totalStockReceived = 0;
    let totalChallanAmount = 0;

    challans.forEach((ch) => {
      let chAmt = Number(ch.totalAmount || 0);
      let itemsAmt = 0;
      (ch.items || []).forEach((item) => {
        const pId = String(item.product?._id || item.product);
        const qty = Number(item.quantity || 0);
        const unitPrice = Number(
          item.price || item.pricePerUnit || productPriceMap[pId] || 0
        );
        totalStockReceived += qty;
        challanProductQtyMap[pId] = (challanProductQtyMap[pId] || 0) + qty;
        itemsAmt += (item.amount || (qty * unitPrice));
      });
      totalChallanAmount += (chAmt > 0 ? chAmt : itemsAmt);
    });

    const stockSummary = inventories.map((inv) => {
      const pId = String(inv.product?._id || inv.product);
      const stockRec = challanProductQtyMap[pId] || 0;
      const onlSold = onlineProductQtyMap[pId] || 0;
      const wkSold = walkInProductQtyMap[pId] || 0;
      const remaining = Number(inv.quantity_on_hand || 0);
      const opening = Math.max(0, remaining + onlSold + wkSold - stockRec);

      return {
        product: inv.product?._id || inv.product,
        name: inv.product?.name || "Product",
        sku: inv.product?.sku || inv.sku || "",
        unit: inv.product?.unit || "pcs",
        openingStock: opening,
        stockReceived: stockRec,
        onlineSold: onlSold,
        walkInSold: wkSold,
        remainingStock: remaining,
      };
    });

    const totalRemainingStock = inventories.reduce(
      (sum, inv) => sum + (Number(inv.quantity_on_hand) || 0),
      0
    );

    // 5. Commission & Settlement Calculations
    const commissionPercentage = Number(
      franchise.commissionPercentage !== undefined
        ? franchise.commissionPercentage
        : franchise.commissionOverride?.value || 10
    );

    // Online sale is deducted directly from Challan Bill (Udhar):
    // Challan Bill - Online Sale = Rest Amount
    // Outlet owner pays Rest Amount after deducting their percentage (commission)
    const restAmount = totalChallanAmount > 0
      ? Number(Math.max(0, totalChallanAmount - onlineGrossAmount).toFixed(2))
      : Number(walkInGrossAmount.toFixed(2));

    const commissionAmount = Number(
      ((restAmount * commissionPercentage) / 100).toFixed(2)
    );

    const netPayable = Number(
      Math.max(0, restAmount - commissionAmount).toFixed(2)
    );

    const totalSalesAmount = Number((onlineGrossAmount + walkInGrossAmount).toFixed(2));
    const currentInventoryValue = inventories.reduce(
      (sum, inv) => sum + (Number(inv.quantity_on_hand || 0) * Number(inv.product?.price || 0)),
      0
    );
    const remainingStockAmount = totalChallanAmount > 0
      ? Number(Math.max(0, totalChallanAmount - totalSalesAmount).toFixed(2))
      : Number(currentInventoryValue.toFixed(2));

    return {
      franchise: {
        _id: franchise._id,
        name: franchise.name,
        code: franchise.code,
        outletCode: franchise.outletCode,
        phone: franchise.phone,
      },
      periodStart,
      periodEnd,
      stockSummary,
      totalStockReceived,
      totalChallanAmount: Number(totalChallanAmount.toFixed(2)),
      restAmount,
      totalOnlineSold: onlineTotalQuantity,
      totalWalkInSold: walkInTotalQuantity,
      totalRemainingStock,
      totalSalesAmount,
      remainingStockAmount,
      onlineSalesSummary: {
        totalOrders: onlineOrders.length,
        grossAmount: Number(onlineGrossAmount.toFixed(2)),
        totalQuantity: onlineTotalQuantity,
      },
      onlineCollectedByCompany: Number(onlineGrossAmount.toFixed(2)),
      walkInSalesSummary: {
        totalBills: walkInBills.length + offlineStockLogs.length,
        grossAmount: Number(walkInGrossAmount.toFixed(2)),
        totalQuantity: walkInTotalQuantity,
      },
      walkInGrossAmount: Number(walkInGrossAmount.toFixed(2)),
      commissionPercentage,
      commissionAmount,
      netPayable,
      includedBillIds: walkInBills.map((b) => b._id),
      includedLogIds: offlineStockLogs.map((l) => l._id),
      includedOrderIds: onlineOrders.map((o) => o._id),
    };
  }

  /**
   * Confirm Settlement and save immutable record
   */
  async confirmSettlement({ franchiseId, startDate, endDate, notes = "", admin = null }) {
    const preview = await this.previewSettlement({ franchiseId, startDate, endDate });

    const settlementNumber = await FranchiseSettlement.generateSettlementNumber();

    const settlement = new FranchiseSettlement({
      settlementNumber,
      franchise: preview.franchise._id,
      periodStart: preview.periodStart,
      periodEnd: preview.periodEnd,
      stockSummary: preview.stockSummary,
      totalStockReceived: preview.totalStockReceived,
      totalChallanAmount: preview.totalChallanAmount,
      restAmount: preview.restAmount,
      totalOnlineSold: preview.totalOnlineSold,
      totalWalkInSold: preview.totalWalkInSold,
      totalRemainingStock: preview.totalRemainingStock,
      totalSalesAmount: preview.totalSalesAmount,
      remainingStockAmount: preview.remainingStockAmount,
      onlineSalesSummary: preview.onlineSalesSummary,
      onlineCollectedByCompany: preview.onlineCollectedByCompany,
      walkInSalesSummary: preview.walkInSalesSummary,
      walkInGrossAmount: preview.walkInGrossAmount,
      commissionPercentage: preview.commissionPercentage,
      commissionAmount: preview.commissionAmount,
      netPayable: preview.netPayable,
      amountPaid: 0,
      remainingAmount: preview.netPayable,
      paymentStatus: preview.netPayable === 0 ? "paid" : "unpaid",
      status: "confirmed",
      notes: notes || "",
      createdBy: admin?._id || null,
      confirmedAt: new Date(),
    });

    await settlement.save();

    // Mark all included CounterBills and Offline Stock Logs as settled so they won't be double counted
    if (preview.includedBillIds && preview.includedBillIds.length > 0) {
      await CounterBill.updateMany(
        { _id: { $in: preview.includedBillIds } },
        { $set: { isSettled: true, settlement: settlement._id } }
      );
    }

    if (preview.includedLogIds && preview.includedLogIds.length > 0) {
      await OutletStockLog.updateMany(
        { _id: { $in: preview.includedLogIds } },
        { $set: { is_settled: true, settlement: settlement._id } }
      );
    }

    return settlement;
  }

  /**
   * Record payment against a settlement (Supports partial payments)
   */
  async recordSettlementPayment({ settlementId, amount, paymentMethod = "upi", reference = "", notes = "", admin = null }) {
    const safeAmount = Number(amount);
    if (isNaN(safeAmount) || safeAmount <= 0) {
      throw new Error("Please enter a valid payment amount.");
    }

    const settlement = await FranchiseSettlement.findById(settlementId);
    if (!settlement) {
      throw new Error("Settlement record not found.");
    }

    const paymentRecord = {
      amount: safeAmount,
      paymentMethod,
      reference: reference || "",
      notes: notes || "",
      paymentDate: new Date(),
      recordedBy: admin?._id || null,
    };

    settlement.payments.push(paymentRecord);
    settlement.amountPaid = Number(((settlement.amountPaid || 0) + safeAmount).toFixed(2));
    settlement.remainingAmount = Number(Math.max(0, settlement.netPayable - settlement.amountPaid).toFixed(2));

    if (settlement.remainingAmount <= 0) {
      settlement.paymentStatus = "paid";
    } else {
      settlement.paymentStatus = "partial";
    }

    await settlement.save();
    return settlement;
  }

  /**
   * List Settlements with filters
   */
  async getSettlements({ franchiseId, paymentStatus, page = 1, limit = 50 }) {
    const match = {};
    if (franchiseId && franchiseId !== "all") {
      match.franchise = franchiseId;
    }
    if (paymentStatus && paymentStatus !== "all") {
      match.paymentStatus = paymentStatus;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [settlements, totalCount] = await Promise.all([
      FranchiseSettlement.find(match)
        .populate("franchise", "name code outletCode phone address")
        .populate("createdBy", "name email")
        .sort({ confirmedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      FranchiseSettlement.countDocuments(match),
    ]);

    return {
      settlements,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(totalCount / Number(limit)),
      },
    };
  }

  /**
   * Get single Settlement details
   */
  async getSettlementDetails(id) {
    const settlement = await FranchiseSettlement.findById(id)
      .populate("franchise", "name code outletCode phone address")
      .populate("createdBy", "name email")
      .populate("payments.recordedBy", "name")
      .lean();

    if (!settlement) {
      throw new Error("Settlement not found.");
    }
    return settlement;
  }

  /**
   * Sales Summary for Franchise Details Page
   */
  async getFranchiseSalesSummary({ franchiseId, startDate, endDate }) {
    const matchTime = {};
    if (startDate) matchTime.$gte = new Date(startDate);
    if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      matchTime.$lte = eDate;
    }

    const billMatch = { franchise: new mongoose.Types.ObjectId(franchiseId) };
    const orderMatch = {
      franchise: new mongoose.Types.ObjectId(franchiseId),
      paymentStatus: "completed",
      status: { $nin: ["cancelled", "refunded"] },
    };

    if (Object.keys(matchTime).length > 0) {
      billMatch.createdAt = matchTime;
      orderMatch.createdAt = matchTime;
    }

    const [walkInBills, onlineOrders] = await Promise.all([
      CounterBill.find(billMatch).lean(),
      Order.find(orderMatch).lean(),
    ]);

    const walkInSalesAmount = walkInBills.reduce((sum, b) => sum + (Number(b.grand_total) || 0), 0);
    const onlineSalesAmount = onlineOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

    return {
      walkInSales: {
        totalBills: walkInBills.length,
        totalAmount: Number(walkInSalesAmount.toFixed(2)),
      },
      onlineSales: {
        totalOrders: onlineOrders.length,
        totalAmount: Number(onlineSalesAmount.toFixed(2)),
      },
      totalSalesAmount: Number((walkInSalesAmount + onlineSalesAmount).toFixed(2)),
    };
  }

  /**
   * Current Stock Summary for Franchise Details Page
   */
  async getFranchiseStockSummary({ franchiseId }) {
    const inventory = await FranchiseInventory.find({ franchise: franchiseId })
      .populate("product", "name sku unit price image images")
      .lean();

    const totalStock = inventory.reduce((sum, i) => sum + (Number(i.quantity_on_hand) || 0), 0);
    const totalAvailable = inventory.reduce((sum, i) => sum + (Number(i.available_quantity) || 0), 0);

    return {
      totalStock,
      totalAvailable,
      items: inventory.map((inv) => ({
        product: inv.product?._id,
        name: inv.product?.name,
        sku: inv.product?.sku || inv.sku,
        unit: inv.product?.unit || "pcs",
        price: inv.product?.price || 0,
        quantityOnHand: inv.quantity_on_hand || 0,
        availableQuantity: inv.available_quantity || 0,
        reservedQuantity: inv.reserved_quantity || 0,
      })),
    };
  }
}

module.exports = new FranchiseSettlementService();

