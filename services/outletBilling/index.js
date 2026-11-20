const mongoose = require("mongoose");
const OutletChallan = require("../../models/outletChallanModel");
const OutletBillingSettlement = require("../../models/outletBillingSettlementModel");
const Franchise = require("../../models/franchiseModel");
const Product = require("../../models/productsModel");
const Order = require("../../models/orderModel");
const CounterBill = require("../../models/counterBillModel");
const OutletStockLog = require("../../models/outletStockLogModel");

// Safe amount parser handling Decimal128, lean objects, strings, numbers
const parseAmount = (val) => {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "object") {
    if (val.$numberDecimal) return parseFloat(val.$numberDecimal) || 0;
    if (typeof val.toString === "function") {
      const s = val.toString();
      return parseFloat(s) || 0;
    }
  }
  return 0;
};

// Safe helper to extract total amount from an Order
const getOrderTotalAmount = (order) => {
  if (!order) return 0;
  const finalAmt = parseAmount(order.finalTotalAmount);
  if (finalAmt > 0) return finalAmt;

  const totAmt = parseAmount(order.totalAmount);
  if (totAmt > 0) return totAmt;

  const discAmt = parseAmount(order.discountedTotalAmount);
  if (discAmt > 0) return discAmt;

  if (Array.isArray(order.items)) {
    return order.items.reduce((sum, it) => {
      const itemAmt =
        parseAmount(it.discounted_total_amount) ||
        parseAmount(it.total_amount) ||
        parseAmount(it.price) * (Number(it.quantity) || 1);
      return sum + itemAmt;
    }, 0);
  }
  return 0;
};

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
  async getLiveCalculation({ franchiseId, startDate = null, endDate = null }) {
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
      (sum, c) => sum + (parseAmount(c.totalAmount) || 0),
      0
    );
    const totalChallanPieces = activeChallans.reduce(
      (sum, c) => sum + (Number(c.totalQuantity) || 0),
      0
    );

    // Determine period boundaries
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const lastSettlement = await OutletBillingSettlement.findOne({
      franchise: franchise._id,
    })
      .sort({ periodEnd: -1, createdAt: -1 })
      .lean();

    let periodStart;
    if (startDate && !isNaN(new Date(startDate).getTime())) {
      periodStart = new Date(startDate);
      periodStart.setHours(0, 0, 0, 0);
    } else if (lastSettlement && lastSettlement.periodEnd) {
      periodStart = new Date(lastSettlement.periodEnd);
    } else if (activeChallans.length > 0) {
      const chDate = new Date(activeChallans[0].dispatchDate);
      const chDayStart = new Date(chDate.getFullYear(), chDate.getMonth(), chDate.getDate(), 0, 0, 0, 0);
      periodStart = chDayStart < todayStart ? chDayStart : todayStart;
    } else {
      periodStart = todayStart;
    }

    let periodEnd;
    if (endDate && !isNaN(new Date(endDate).getTime())) {
      periodEnd = new Date(endDate);
      periodEnd.setHours(23, 59, 59, 999);
    } else {
      periodEnd = new Date();
    }

    // Online Sales Query
    // Matches orders assigned to this franchise with Cashfree / prepaid / confirmed status
    const orderQuery = {
      $or: [
        { franchise: franchise._id },
        { franchise: new mongoose.Types.ObjectId(franchiseId) },
        { franchise: String(franchise._id) },
      ],
      createdAt: { $gte: periodStart, $lte: periodEnd },
      status: { $nin: ["cancelled", "refunded", "failed"] },
      paymentStatus: { $ne: "failed" },
    };

    const rawOnlineOrders = await Order.find(orderQuery)
      .sort({ createdAt: -1 })
      .lean();

    // Filter to ensure only valid online orders (exclude unpaid COD)
    const onlineOrders = rawOnlineOrders.filter((o) => {
      if (o.paymentMode === "COD" && o.paymentStatus !== "paid") return false;
      return true;
    });

    const onlineSalesAmount = onlineOrders.reduce(
      (sum, o) => sum + getOrderTotalAmount(o),
      0
    );

    // Franchise match criteria
    const franchiseMatches = [
      { franchise: franchise._id },
      { franchise: new mongoose.Types.ObjectId(franchiseId) },
      { franchise: String(franchise._id) },
    ];

    // Walk-in Counter Sales (CounterBill & Counter Stock Logs)
    const walkInQuery = {
      $and: [
        { $or: franchiseMatches },
        {
          $or: [
            { createdAt: { $gte: periodStart, $lte: periodEnd } },
            { bill_date: { $gte: periodStart, $lte: periodEnd } },
          ],
        },
      ],
    };

    const walkInBills = await CounterBill.find(walkInQuery)
      .sort({ createdAt: -1 })
      .lean();

    // Also fetch any manual counter sales recorded in OutletStockLog (type: "counter_sale")
    const counterLogsQuery = {
      $and: [
        { $or: franchiseMatches },
        { type: "counter_sale" },
        { createdAt: { $gte: periodStart, $lte: periodEnd } },
      ],
    };

    const counterLogs = await OutletStockLog.find(counterLogsQuery)
      .populate("product", "name price discounted_price unit sku")
      .sort({ createdAt: -1 })
      .lean();

    // Set of known bill numbers from CounterBill to prevent double-counting
    const knownBillNumbers = new Set(
      walkInBills.map((b) => String(b.bill_number || "").trim().toUpperCase()).filter(Boolean)
    );

    // Standalone stock logs (not already linked to a CounterBill)
    const standaloneLogs = counterLogs.filter((l) => {
      const bNo = String(l.bill_no || "").trim().toUpperCase();
      return !bNo || !knownBillNumbers.has(bNo);
    });

    // Unified offline sales list for UI viewing
    const offlineOrdersList = [];

    for (const b of walkInBills) {
      const bAmt = parseAmount(b.grand_total) || parseAmount(b.received_amount) || 0;
      offlineOrdersList.push({
        _id: b._id,
        billNumber: b.bill_number || `POS-${String(b._id).slice(-6)}`,
        date: b.bill_date || b.createdAt,
        customerName: b.customer_name || "Walk-in Customer",
        customerPhone: b.customer_phone || "—",
        amount: Number(bAmt.toFixed(2)),
        itemsCount: b.items?.length || b.total_quantity || 1,
        paymentMethod: b.payment_method || "cash",
        source: "pos",
      });
    }

    for (const l of standaloneLogs) {
      const lAmt =
        parseAmount(l.total_amount) ||
        (parseAmount(l.unit_price) * (Number(l.quantity) || 1)) ||
        parseAmount(l.received_amount) ||
        0;
      offlineOrdersList.push({
        _id: l._id,
        billNumber: l.bill_no || `SALE-${String(l._id).slice(-6)}`,
        date: l.createdAt,
        customerName: l.customer_name || "Counter Customer",
        customerPhone: l.customer_mobile || "—",
        amount: Number(lAmt.toFixed(2)),
        itemsCount: Number(l.quantity) || 1,
        paymentMethod: l.payment_method || "cash",
        source: "counter_sale",
      });
    }

    offlineOrdersList.sort((a, b) => new Date(b.date) - new Date(a.date));

    const walkInSalesAmount = offlineOrdersList.reduce((sum, it) => sum + it.amount, 0);
    const walkInBillsCount = offlineOrdersList.length;

    // 5-Step Exact Billing Formula:
    // 1. Total Challan Udhar (Stock dispatched to store)
    // 2. Online Sales (Cashfree) deducted 100% (company already received this from customers)
    const restAmount = totalChallanAmount > 0
      ? Math.max(0, totalChallanAmount - onlineSalesAmount)
      : walkInSalesAmount;

    // 3. Franchise Commission / Margin:
    // Store gets commission on Online Sales (store packed/delivered the order):
    const onlineCommission = Number(((onlineSalesAmount * commissionPercentage) / 100).toFixed(2));
    // Store gets margin on the remaining / offline stock:
    const restCommission = totalChallanAmount > 0
      ? Number(((restAmount * commissionPercentage) / 100).toFixed(2))
      : Number(((walkInSalesAmount * commissionPercentage) / 100).toFixed(2));
    // Total commission credited to franchise:
    const commissionAmount = Number((onlineCommission + restCommission).toFixed(2));

    // 4. Final Net Payable (Outlet Owner Dega to Company)
    // Outlet owner owes restAmount minus total commission (including online sales commission credit):
    const netPayable = Number(Math.max(0, restAmount - commissionAmount).toFixed(2));

    // 5. Query any outstanding balance from past finalized bills (unpaid / partial)
    const pastUnpaidBills = await OutletBillingSettlement.find({
      franchise: franchise._id,
      paymentStatus: { $in: ["unpaid", "partial"] },
    }).lean();

    const pastOutstandingBalance = pastUnpaidBills.reduce(
      (sum, b) => sum + (Number(b.remainingAmount) || 0),
      0
    );
    const totalDueWithPast = Number((netPayable + pastOutstandingBalance).toFixed(2));

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
        const pId = String(item.product?._id || item.product || "");
        if (productMap[pId]) {
          productMap[pId].onlineSoldQty += Number(item.quantity) || 0;
        }
      }
    }

    // Accumulate Offline Sold Qty from CounterBills
    for (const bill of walkInBills) {
      for (const item of bill.items || []) {
        const pId = String(item.product?._id || item.product || "");
        if (!productMap[pId]) {
          productMap[pId] = {
            product: item.product?._id || item.product,
            name: item.name || "Product",
            sku: item.sku || "",
            unit: item.unit || "pcs",
            price: Number(item.selling_price) || 0,
            dispatchedQty: 0,
            onlineSoldQty: 0,
            offlineSoldQty: 0,
            totalSoldQty: 0,
            remainingQty: 0,
          };
        }
        productMap[pId].offlineSoldQty += Number(item.quantity) || 0;
      }
    }

    // Accumulate Offline Sold Qty from standalone counter logs
    for (const log of standaloneLogs) {
      const pId = String(log.product?._id || log.product || "");
      if (!productMap[pId]) {
        productMap[pId] = {
          product: log.product?._id || log.product,
          name: log.product?.name || log.sku || "Product",
          sku: log.sku || "",
          unit: log.product?.unit || "pcs",
          price: Number(log.unit_price) || 0,
          dispatchedQty: 0,
          onlineSoldQty: 0,
          offlineSoldQty: 0,
          totalSoldQty: 0,
          remainingQty: 0,
        };
      }
      productMap[pId].offlineSoldQty += Number(log.quantity) || 0;
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
      onlineOrdersList: onlineOrders.slice(0, 30).map((o) => ({
        _id: o._id,
        orderNumber: o.orderNumber,
        amount: getOrderTotalAmount(o),
        date: o.createdAt,
        itemsCount: o.items?.length || 0,
        paymentMode: o.paymentMode || "ONLINE",
        status: o.status,
      })),
      walkInBillsCount,
      walkInSalesAmount: Number(walkInSalesAmount.toFixed(2)),
      offlineSalesCount: walkInBillsCount,
      offlineSalesAmount: Number(walkInSalesAmount.toFixed(2)),
      offlineOrdersList: offlineOrdersList.slice(0, 50),
      totalSalesAmount: Number((onlineSalesAmount + walkInSalesAmount).toFixed(2)),
      restAmount: Number(restAmount.toFixed(2)),
      commissionPercentage,
      onlineCommissionAmount: Number(onlineCommission.toFixed(2)),
      restCommissionAmount: Number(restCommission.toFixed(2)),
      commissionAmount,
      netPayable,
      pastOutstandingBalance,
      pastUnpaidBillsCount: pastUnpaidBills.length,
      totalDueWithPast,
      productBreakdown,
    };
  }

  /**
   * 4. 1-Click Generate Bill (Locks active challans into a permanent Bill Slip)
   */
  async generateBill({ franchiseId, startDate = null, endDate = null, notes = "", admin = null }) {
    const calc = await this.getLiveCalculation({ franchiseId, startDate, endDate });

    if (calc.totalChallanAmount <= 0 && calc.walkInSalesAmount <= 0 && calc.onlineSalesAmount <= 0) {
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
