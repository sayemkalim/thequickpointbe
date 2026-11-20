const mongoose = require("mongoose");
const OutletChallan = require("../../models/outletChallanModel");
const OutletBillingSettlement = require("../../models/outletBillingSettlementModel");
const Franchise = require("../../models/franchiseModel");
const Product = require("../../models/productsModel");
const Order = require("../../models/orderModel");
const CounterBill = require("../../models/counterBillModel");
const FranchiseInventory = require("../../models/franchiseInventoryModel");
const OutletStockLog = require("../../models/outletStockLogModel");

class OutletBillingService {
  /**
   * 1. Create a fresh Stock Challan (Consignment Udhar)
   */
  async createChallan({ franchiseId, items, notes = "", admin = null }) {
    if (!franchiseId) {
      throw new Error("Franchise store is required.");
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Challan must contain at least one item.");
    }

    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) {
      throw new Error("Franchise store not found.");
    }

    const processedItems = [];
    let totalQuantity = 0;
    let totalAmount = 0;

    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      if (isNaN(qty) || qty <= 0) continue;

      const pId = item.product || item.productId;
      const product = await Product.findById(pId);
      if (!product) continue;

      const unitPrice = Number(
        item.price || item.pricePerUnit || product.discounted_price || product.price || 0
      );
      const lineAmount = Number((unitPrice * qty).toFixed(2));

      processedItems.push({
        product: product._id,
        name: product.name,
        sku: product.sku || item.sku || "",
        unit: product.unit || item.unit || "pcs",
        quantity: qty,
        price: unitPrice,
        amount: lineAmount,
      });

      totalQuantity += qty;
      totalAmount += lineAmount;
    }

    if (processedItems.length === 0) {
      throw new Error("No valid items to include in challan.");
    }

    const challanNumber = await OutletChallan.generateChallanNumber();

    const challan = new OutletChallan({
      challanNumber,
      franchise: franchise._id,
      items: processedItems,
      totalQuantity,
      totalAmount: Number(totalAmount.toFixed(2)),
      dispatchDate: new Date(),
      status: "active",
      notes: notes || "Stock dispatched on consignment credit",
      createdBy: admin?._id || null,
    });

    let saved = false;
    let attempts = 0;
    while (!saved && attempts < 5) {
      try {
        await challan.save();
        saved = true;
      } catch (saveErr) {
        if (saveErr.code === 11000 || saveErr.message?.includes("E11000")) {
          attempts++;
          challan.challanNumber = await OutletChallan.generateChallanNumber();
        } else {
          throw saveErr;
        }
      }
    }

    return challan;
  }

  /**
   * 2. List Challans with pagination
   */
  async getChallans({ franchiseId, status, page = 1, limit = 50 }) {
    const match = {};
    if (franchiseId && franchiseId !== "all") {
      if (mongoose.Types.ObjectId.isValid(franchiseId)) {
        match.franchise = franchiseId;
      }
    }
    if (status && status !== "all") {
      match.status = status;
    }

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
    const skip = (safePage - 1) * safeLimit;

    const [challans, totalCount] = await Promise.all([
      OutletChallan.find(match)
        .populate("franchise", "name code outletCode phone address")
        .populate("createdBy", "name email")
        .sort({ dispatchDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      OutletChallan.countDocuments(match),
    ]);

    return {
      challans: Array.isArray(challans) ? challans : [],
      pagination: {
        total: totalCount,
        page: safePage,
        limit: safeLimit,
        pages: Math.ceil(totalCount / safeLimit),
      },
    };
  }

  /**
   * 3. Live Billing Calculation (Challan Udhar - Online Sales = Rest Amount - Commission % = Outlet Owner Dega)
   */
  async getLiveCalculation({ franchiseId }) {
    if (!franchiseId || !mongoose.Types.ObjectId.isValid(franchiseId)) {
      throw new Error("Valid Franchise ID is required.");
    }

    const franchise = await Franchise.findById(franchiseId).lean();
    if (!franchise) {
      throw new Error("Franchise store not found.");
    }

    const commissionPercentage = Number(
      franchise.commissionPercentage !== undefined
        ? franchise.commissionPercentage
        : franchise.commissionOverride?.value !== undefined
        ? franchise.commissionOverride.value
        : 10
    );

    // Active (unsettled) challans
    const activeChallans = await OutletChallan.find({
      franchise: franchise._id,
      status: "active",
    })
      .sort({ dispatchDate: 1 })
      .lean();

    const totalChallanAmount = activeChallans.reduce(
      (sum, c) => sum + (Number(c.totalAmount) || 0),
      0
    );
    const totalChallanPieces = activeChallans.reduce(
      (sum, c) => sum + (Number(c.totalQuantity) || 0),
      0
    );

    // Find period start (date of first active challan, or start of current day if no active challans)
    let periodStart = activeChallans.length > 0 ? new Date(activeChallans[0].dispatchDate) : null;
    if (!periodStart) {
      const now = new Date();
      periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    }
    const periodEnd = new Date();

    // Online Sales during active period
    const onlineOrders = await Order.find({
      franchise: franchise._id,
      createdAt: { $gte: periodStart, $lte: periodEnd },
      paymentStatus: "completed",
      status: { $nin: ["cancelled", "refunded"] },
    }).lean();

    const onlineSalesAmount = onlineOrders.reduce(
      (sum, o) => sum + (Number(o.totalAmount) || 0),
      0
    );

    // Walk-in Counter Sales during active period
    const walkInBills = await CounterBill.find({
      franchise: franchise._id,
      createdAt: { $gte: periodStart, $lte: periodEnd },
    }).lean();

    const walkInSalesAmount = walkInBills.reduce(
      (sum, b) => sum + (Number(b.grand_total) || 0),
      0
    );

    // 5-Step Exact Billing Formula
    // 1. Total Challan Udhar
    // 2. Online Sales (Cashfree) is deducted 100% from Challan Bill
    const restAmount = totalChallanAmount > 0
      ? Math.max(0, totalChallanAmount - onlineSalesAmount)
      : walkInSalesAmount;

    // 4. Franchise Commission
    const commissionAmount = Number(((restAmount * commissionPercentage) / 100).toFixed(2));

    // 5. Final Net Payable (Outlet Owner Dega)
    const netPayable = Number(Math.max(0, restAmount - commissionAmount).toFixed(2));

    // Itemized Product Movement (Dispatched - Online Sold - Offline Sold = Remaining)
    const productMap = {};

    for (const ch of activeChallans) {
      for (const it of ch.items || []) {
        const pId = String(it.product);
        if (!productMap[pId]) {
          productMap[pId] = {
            product: it.product,
            name: it.name,
            sku: it.sku || "",
            unit: it.unit || "pcs",
            price: Number(it.price) || 0,
            dispatchedQty: 0,
            onlineSoldQty: 0,
            offlineSoldQty: 0,
            totalSoldQty: 0,
            remainingQty: 0,
          };
        }
        productMap[pId].dispatchedQty += Number(it.quantity) || 0;
      }
    }

    // Accumulate Online Sold Qty
    for (const order of onlineOrders) {
      for (const item of order.items || []) {
        const pId = String(item.product?._id || item.product);
        if (productMap[pId]) {
          productMap[pId].onlineSoldQty += Number(item.quantity) || 0;
        }
      }
    }

    // Accumulate Offline Sold Qty
    for (const bill of walkInBills) {
      for (const item of bill.items || []) {
        const pId = String(item.product?._id || item.product);
        if (productMap[pId]) {
          productMap[pId].offlineSoldQty += Number(item.quantity) || 0;
        }
      }
    }

    const productBreakdown = Object.values(productMap).map((p) => {
      p.totalSoldQty = p.onlineSoldQty + p.offlineSoldQty;
      p.remainingQty = Math.max(0, p.dispatchedQty - p.totalSoldQty);
      return p;
    });

    return {
      franchise: {
        _id: franchise._id,
        name: franchise.name,
        code: franchise.code || franchise.outletCode,
        phone: franchise.phone,
        address: franchise.address,
      },
      periodStart,
      periodEnd,
      activeChallans: activeChallans.map((c) => ({
        _id: c._id,
        challanNumber: c.challanNumber,
        dispatchDate: c.dispatchDate,
        totalQuantity: c.totalQuantity,
        totalAmount: c.totalAmount,
        itemsCount: c.items?.length || 0,
      })),
      totalChallanPieces,
      // 5-Step Formula Data:
      totalChallanAmount: Number(totalChallanAmount.toFixed(2)),
      onlineSalesCount: onlineOrders.length,
      onlineSalesAmount: Number(onlineSalesAmount.toFixed(2)),
      walkInBillsCount: walkInBills.length,
      walkInSalesAmount: Number(walkInSalesAmount.toFixed(2)),
      restAmount: Number(restAmount.toFixed(2)),
      commissionPercentage,
      commissionAmount,
      netPayable,
      productBreakdown,
    };
  }

  /**
   * 4. 1-Click Generate Bill (Locks active challans into a permanent Bill Slip)
   */
  async generateBill({ franchiseId, notes = "", admin = null }) {
    const calc = await this.getLiveCalculation({ franchiseId });

    if (calc.totalChallanAmount <= 0 && calc.walkInSalesAmount <= 0) {
      throw new Error("No active stock challan or sales found to generate a bill.");
    }

    const billNumber = await OutletBillingSettlement.generateBillNumber();

    const bill = new OutletBillingSettlement({
      billNumber,
      franchise: franchiseId,
      periodStart: calc.periodStart,
      periodEnd: calc.periodEnd,
      challans: calc.activeChallans.map((c) => ({
        challanId: c._id,
        challanNumber: c.challanNumber,
        amount: c.totalAmount,
        totalQuantity: c.totalQuantity,
        dispatchDate: c.dispatchDate,
      })),
      totalChallanAmount: calc.totalChallanAmount,
      onlineSalesCount: calc.onlineSalesCount,
      onlineSalesAmount: calc.onlineSalesAmount,
      walkInBillsCount: calc.walkInBillsCount,
      walkInSalesAmount: calc.walkInSalesAmount,
      restAmount: calc.restAmount,
      commissionPercentage: calc.commissionPercentage,
      commissionAmount: calc.commissionAmount,
      netPayable: calc.netPayable,
      productBreakdown: calc.productBreakdown,
      amountPaid: 0,
      remainingAmount: calc.netPayable,
      paymentStatus: calc.netPayable <= 0 ? "paid" : "unpaid",
      notes: notes || "Daily / Restock settlement bill",
      createdBy: admin?._id || null,
    });

    let saved = false;
    let attempts = 0;
    while (!saved && attempts < 5) {
      try {
        await bill.save();
        saved = true;
      } catch (saveErr) {
        if (saveErr.code === 11000 || saveErr.message?.includes("E11000")) {
          attempts++;
          bill.billNumber = await OutletBillingSettlement.generateBillNumber();
        } else {
          throw saveErr;
        }
      }
    }

    // Mark all included active challans as settled
    const challanIds = calc.activeChallans.map((c) => c._id);
    if (challanIds.length > 0) {
      await OutletChallan.updateMany(
        { _id: { $in: challanIds } },
        { status: "settled", settlementId: bill._id }
      );
    }

    return await OutletBillingSettlement.findById(bill._id)
      .populate("franchise", "name code outletCode phone address")
      .populate("createdBy", "name email")
      .lean();
  }

  /**
   * 5. Get Bills History with pagination
   */
  async getBills({ franchiseId, page = 1, limit = 50 }) {
    const match = {};
    if (franchiseId && franchiseId !== "all") {
      if (mongoose.Types.ObjectId.isValid(franchiseId)) {
        match.franchise = franchiseId;
      }
    }

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
    const skip = (safePage - 1) * safeLimit;

    const [bills, totalCount] = await Promise.all([
      OutletBillingSettlement.find(match)
        .populate("franchise", "name code outletCode phone address")
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      OutletBillingSettlement.countDocuments(match),
    ]);

    return {
      bills: Array.isArray(bills) ? bills : [],
      pagination: {
        total: totalCount,
        page: safePage,
        limit: safeLimit,
        pages: Math.ceil(totalCount / safeLimit),
      },
    };
  }

  /**
   * 6. Record Payment against a Bill
   */
  async recordPayment({ billId, amount, paymentMethod = "cash", reference = "", notes = "", admin = null }) {
    const bill = await OutletBillingSettlement.findById(billId);
    if (!bill) {
      throw new Error("Settlement bill not found.");
    }

    const payAmt = Number(amount);
    if (isNaN(payAmt) || payAmt <= 0) {
      throw new Error("Payment amount must be greater than 0.");
    }

    bill.payments.push({
      amount: payAmt,
      paymentMethod,
      reference,
      date: new Date(),
      notes,
      recordedBy: admin?._id || null,
    });

    bill.amountPaid = Number(((bill.amountPaid || 0) + payAmt).toFixed(2));
    bill.remainingAmount = Number(Math.max(0, bill.netPayable - bill.amountPaid).toFixed(2));

    if (bill.remainingAmount <= 0) {
      bill.paymentStatus = "paid";
    } else {
      bill.paymentStatus = "partial";
    }

    await bill.save();

    return await OutletBillingSettlement.findById(billId)
      .populate("franchise", "name code outletCode phone address")
      .populate("createdBy", "name email")
      .lean();
  }
}

module.exports = new OutletBillingService();
