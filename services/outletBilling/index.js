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
  async getLiveCalculation({ franchiseId, startDate = null, endDate = null, challanId = null, manualOfflineSalesAmount = null }) {
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

    // Filter challans: either a specific challan or all active consignment challans
    const challanQuery = {
      franchise: franchise._id,
      status: { $in: ["active", "partial"] },
    };
    if (challanId && challanId !== "all" && mongoose.Types.ObjectId.isValid(challanId)) {
      challanQuery._id = challanId;
    }

    const activeChallans = await OutletChallan.find(challanQuery)
      .sort({ dispatchDate: 1 })
      .lean();

    const totalChallanPieces = activeChallans.reduce(
      (sum, c) => sum + (Number(c.totalQuantity) || 0),
      0
    );

    // Determine period boundaries
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const prevSettlements = await OutletBillingSettlement.find({
      franchise: franchise._id,
    })
      .select("settledOrders settledCounterBills periodEnd createdAt")
      .sort({ periodEnd: -1, createdAt: -1 })
      .lean();

    const lastSettlement = prevSettlements.length > 0 ? prevSettlements[0] : null;

    // Zero Double-Billing: Collect IDs of orders & counter bills already settled in previous bills
    const alreadySettledOrderIds = new Set(
      prevSettlements.flatMap((s) => s.settledOrders || []).map(String).filter(Boolean)
    );
    const alreadySettledBillIds = new Set(
      prevSettlements.flatMap((s) => s.settledCounterBills || []).map(String).filter(Boolean)
    );

    let periodStart;
    if (startDate && !isNaN(new Date(startDate).getTime())) {
      periodStart = new Date(startDate);
      periodStart.setHours(0, 0, 0, 0);
    } else if (activeChallans.length > 0) {
      // Sales for this restock batch start strictly when this challan was dispatched
      periodStart = new Date(activeChallans[0].dispatchDate);
      if (lastSettlement && lastSettlement.periodEnd && new Date(lastSettlement.periodEnd) > periodStart) {
        periodStart = new Date(lastSettlement.periodEnd);
      }
    } else if (lastSettlement && lastSettlement.periodEnd) {
      periodStart = new Date(lastSettlement.periodEnd);
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

    // Online Sales Query (Prepaid / Cashfree direct to company)
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

    // Filter to ensure valid prepaid orders AND exclude any already settled orders
    const onlineOrders = rawOnlineOrders.filter((o) => {
      if (alreadySettledOrderIds.has(String(o._id))) return false;
      if (o.paymentMode === "COD" && o.paymentStatus !== "paid") return false;
      return true;
    });

    const onlineSalesAmount = Number(
      onlineOrders.reduce((sum, o) => sum + getOrderTotalAmount(o), 0).toFixed(2)
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

    // Prevent double counting across bills & logs
    const knownBillNumbers = new Set(
      walkInBills.map((b) => String(b.bill_number || "").trim().toUpperCase()).filter(Boolean)
    );

    const standaloneLogs = counterLogs.filter((l) => {
      const bNo = String(l.bill_no || "").trim().toUpperCase();
      return !bNo || !knownBillNumbers.has(bNo);
    });

    // Unified offline sales list, excluding already settled items
    const offlineOrdersList = [];

    for (const b of walkInBills) {
      if (alreadySettledBillIds.has(String(b._id))) continue;
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
      if (alreadySettledBillIds.has(String(l._id))) continue;
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
            remainingStockValue: 0,
          };
        }
        productMap[pId].dispatchedQty += Number(it.quantity) || 0;
      }
    }

    // Accumulate Online Sold Qty (only from unsettled orders)
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
      if (alreadySettledBillIds.has(String(bill._id))) continue;
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
            remainingStockValue: 0,
          };
        }
        productMap[pId].offlineSoldQty += Number(item.quantity) || 0;
      }
    }

    // Accumulate Offline Sold Qty from standalone counter logs
    for (const log of standaloneLogs) {
      if (alreadySettledBillIds.has(String(log._id))) continue;
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
          remainingStockValue: 0,
        };
      }
      productMap[pId].offlineSoldQty += Number(log.quantity) || 0;
    }

    let calculatedDispatchedValue = 0;
    let calculatedRemainingStockValue = 0;
    let challanOfflineSoldAmount = 0;
    let challanOnlineSoldAmount = 0;

    const productBreakdown = Object.values(productMap).map((p) => {
      // Online sold cannot exceed dispatched
      p.onlineSoldQty = Math.min(p.dispatchedQty, p.onlineSoldQty);
      // Offline sold cannot exceed remaining stock of this product in this challan
      const availableForOffline = Math.max(0, p.dispatchedQty - p.onlineSoldQty);
      p.offlineSoldQty = Math.min(availableForOffline, p.offlineSoldQty);

      p.totalSoldQty = p.onlineSoldQty + p.offlineSoldQty;
      p.remainingQty = Math.max(0, p.dispatchedQty - p.totalSoldQty);
      p.remainingStockValue = Number((p.remainingQty * p.price).toFixed(2));

      calculatedDispatchedValue += p.dispatchedQty * p.price;
      calculatedRemainingStockValue += p.remainingStockValue;
      challanOnlineSoldAmount += p.onlineSoldQty * p.price;
      challanOfflineSoldAmount += p.offlineSoldQty * p.price;
      return p;
    });

    // 1. Total Dispatched Stock Value in Challan(s)
    const rawChallanAmount = activeChallans.reduce(
      (sum, c) => sum + (parseAmount(c.totalAmount) || 0),
      0
    );
    const totalChallanAmount = Number((rawChallanAmount || calculatedDispatchedValue).toFixed(2));

    // Automated Walk-in Counter Sales strictly belonging to THIS specific challan:
    const detectedFromItems = Number(challanOfflineSoldAmount.toFixed(2));
    const allOfflineTotal = Number(offlineOrdersList.reduce((sum, it) => sum + it.amount, 0).toFixed(2));
    const maxWalkInCapacity = totalChallanAmount > 0 ? Math.max(0, totalChallanAmount - onlineSalesAmount) : allOfflineTotal;

    const detectedWalkInSales = detectedFromItems > 0
      ? Number(Math.min(maxWalkInCapacity, detectedFromItems).toFixed(2))
      : Number(Math.min(maxWalkInCapacity, allOfflineTotal).toFixed(2));

    const manualOffline = manualOfflineSalesAmount !== null && manualOfflineSalesAmount !== undefined && manualOfflineSalesAmount !== "" && !isNaN(Number(manualOfflineSalesAmount))
      ? Number(Number(manualOfflineSalesAmount).toFixed(2))
      : null;
    const walkInSalesAmount = manualOffline !== null ? manualOffline : detectedWalkInSales;
    const walkInBillsCount = offlineOrdersList.length;

    // Total Sold from this Challan = Online Sales + Walk-in Sales
    const totalChallanSold = Number((onlineSalesAmount + walkInSalesAmount).toFixed(2));

    // 2. Remaining Unsold Consignment Stock Value on Shelf
    const remainingStockValue = Number(
      Math.max(
        0,
        totalChallanAmount > 0
          ? Math.max(0, totalChallanAmount - totalChallanSold)
          : 0
      ).toFixed(2)
    );

    // 3. Rest Stock Value (Dispatched - Online Sales)
    const restAmount = totalChallanAmount > 0
      ? Math.max(0, totalChallanAmount - onlineSalesAmount)
      : walkInSalesAmount;

    // 4. Franchise Commission & Margins:
    // Store gets margin on Offline Counter Sales (e.g. 10% of ₹700 = ₹70):
    const offlineMarginAmount = Number(((walkInSalesAmount * commissionPercentage) / 100).toFixed(2));
    // Store gets commission credit for fulfilling Online Orders (e.g. 10% of ₹300 = ₹30):
    const onlineCommissionAmount = Number(((onlineSalesAmount * commissionPercentage) / 100).toFixed(2));
    // Total store commission credited:
    const commissionAmount = Number((offlineMarginAmount + onlineCommissionAmount).toFixed(2));

    // 5. Final Net Payable by Outlet Owner to Company:
    // Store owner collected walkInSalesAmount in cash at counter.
    // Store owner remits that collected cash MINUS their total commission (offline margin + online commission credit):
    let netPayable = 0;
    if (walkInSalesAmount > 0) {
      netPayable = Number(Math.max(0, walkInSalesAmount - commissionAmount).toFixed(2));
    } else if (totalChallanAmount > 0 && calculatedRemainingStockValue <= 0 && onlineSalesAmount > 0) {
      netPayable = Number(Math.max(0, restAmount - commissionAmount).toFixed(2));
    } else {
      netPayable = 0;
    }

    // 6. Query any outstanding balance from past finalized bills (unpaid / partial)
    const pastUnpaidBills = await OutletBillingSettlement.find({
      franchise: franchise._id,
      paymentStatus: { $in: ["unpaid", "partial"] },
    }).lean();

    const pastOutstandingBalance = pastUnpaidBills.reduce(
      (sum, b) => sum + (Number(b.remainingAmount) || 0),
      0
    );
    const totalDueWithPast = Number((netPayable + pastOutstandingBalance).toFixed(2));

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
      selectedChallanId: challanId || "all",
      activeChallans: activeChallans.map((c) => ({
        _id: c._id,
        challanNumber: c.challanNumber,
        dispatchDate: c.dispatchDate,
        totalQuantity: c.totalQuantity,
        totalAmount: c.totalAmount,
        itemsCount: c.items?.length || 0,
        items: c.items || [],
      })),
      totalChallanPieces,
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
      detectedWalkInSales: Number(detectedWalkInSales.toFixed(2)),
      isManualOffline: manualOffline !== null,
      offlineSalesCount: walkInBillsCount,
      offlineSalesAmount: Number(walkInSalesAmount.toFixed(2)),
      offlineOrdersList: offlineOrdersList.slice(0, 50),
      totalSalesAmount: Number((onlineSalesAmount + walkInSalesAmount).toFixed(2)),
      totalChallanSold: Number((onlineSalesAmount + walkInSalesAmount).toFixed(2)),
      remainingStockValue,
      restAmount: Number(restAmount.toFixed(2)),
      commissionPercentage,
      offlineMarginAmount,
      onlineCommissionAmount,
      restCommissionAmount: offlineMarginAmount,
      commissionAmount,
      netPayable,
      pastOutstandingBalance,
      pastUnpaidBillsCount: pastUnpaidBills.length,
      totalDueWithPast,
      productBreakdown,
    };
  }

  /**
   * 4. 1-Click Generate Bill (Locks active challans & sales into a permanent Bill Slip)
   */
  async generateBill({ franchiseId, startDate = null, endDate = null, challanId = null, notes = "", admin = null, manualOfflineSalesAmount = null }) {
    const calc = await this.getLiveCalculation({ franchiseId, startDate, endDate, challanId, manualOfflineSalesAmount });

    if (calc.totalChallanAmount <= 0 || !calc.activeChallans || calc.activeChallans.length === 0) {
      throw new Error("Cannot generate settlement bill without an active restock challan. Please restock items from Central Warehouse first.");
    }

    const totalSold = (calc.onlineSalesAmount || 0) + (calc.walkInSalesAmount || 0);
    if (totalSold <= 0) {
      throw new Error("Cannot generate settlement bill: No sales recorded. Please enter offline sales or fulfill online orders before settling.");
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
      remainingStockValue: calc.remainingStockValue,
      restAmount: calc.restAmount,
      commissionPercentage: calc.commissionPercentage,
      offlineMarginAmount: calc.offlineMarginAmount,
      onlineCommissionAmount: calc.onlineCommissionAmount,
      commissionAmount: calc.commissionAmount,
      netPayable: calc.netPayable,
      productBreakdown: calc.productBreakdown,
      // Record settled order and bill IDs to guarantee zero double billing in subsequent settlements
      settledOrders: calc.onlineOrdersList.map((o) => o._id),
      settledCounterBills: calc.offlineOrdersList.map((b) => b._id),
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

    // Mark the settled challans as settled so they cannot be billed again
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

  /**
   * 7. Update Bill Payment Status & Outstanding Balance (Admin Mark Paid / Unpaid / Partial)
   */
  async updateBillStatus({ billId, status, amountPaid = null, admin = null }) {
    const bill = await OutletBillingSettlement.findById(billId);
    if (!bill) {
      throw new Error("Settlement bill not found.");
    }

    if (status === "paid") {
      bill.paymentStatus = "paid";
      bill.amountPaid = bill.netPayable;
      bill.remainingAmount = 0;
      bill.payments.push({
        amount: bill.netPayable,
        paymentMethod: "cash",
        reference: "Marked Full Paid by Super Admin",
        date: new Date(),
        notes: "Full settlement marked paid",
        recordedBy: admin?._id || null,
      });
    } else if (status === "unpaid") {
      bill.paymentStatus = "unpaid";
      bill.amountPaid = 0;
      bill.remainingAmount = bill.netPayable;
      bill.payments = [];
    } else if (status === "partial" && amountPaid != null) {
      const paid = Number(amountPaid);
      if (isNaN(paid) || paid < 0) {
        throw new Error("Invalid payment amount.");
      }
      bill.amountPaid = Number(Math.min(bill.netPayable, paid).toFixed(2));
      bill.remainingAmount = Number(Math.max(0, bill.netPayable - bill.amountPaid).toFixed(2));
      bill.paymentStatus = bill.remainingAmount <= 0 ? "paid" : bill.amountPaid > 0 ? "partial" : "unpaid";
      bill.payments.push({
        amount: paid,
        paymentMethod: "cash",
        reference: "Adjusted by Super Admin",
        date: new Date(),
        notes: `Partial settlement: paid ₹${bill.amountPaid}, balance due ₹${bill.remainingAmount}`,
        recordedBy: admin?._id || null,
      });
    } else {
      throw new Error("Invalid payment status. Must be 'paid', 'unpaid', or 'partial'.");
    }

    await bill.save();

    return await OutletBillingSettlement.findById(billId)
      .populate("franchise", "name code outletCode phone address")
      .populate("createdBy", "name email")
      .lean();
  }

  /**
   * 8. Delete a specific Settlement Bill (Super Admin Cleanup)
   */
  async deleteBill({ billId, admin = null }) {
    const bill = await OutletBillingSettlement.findById(billId);
    if (!bill) {
      throw new Error("Settlement bill not found.");
    }

    // If bill had linked challans, revert them back to active so they can be re-settled or re-stocked
    if (Array.isArray(bill.challans) && bill.challans.length > 0) {
      const challanIds = bill.challans.map((c) => c.challanId).filter(Boolean);
      if (challanIds.length > 0) {
        await OutletChallan.updateMany(
          { _id: { $in: challanIds } },
          { status: "active", settlementId: null }
        );
      }
    }

    await OutletBillingSettlement.findByIdAndDelete(billId);
    return { success: true, message: `Bill #${bill.billNumber} deleted successfully.` };
  }

  /**
   * 9. Reset All Past Billing & Challan Data (Clean Slate)
   */
  async resetAllData({ franchiseId = null, admin = null }) {
    const filter = {};
    if (franchiseId && franchiseId !== "all" && mongoose.Types.ObjectId.isValid(franchiseId)) {
      filter.franchise = franchiseId;
    }

    const [deletedBills, deletedChallans] = await Promise.all([
      OutletBillingSettlement.deleteMany(filter),
      OutletChallan.deleteMany(filter),
    ]);

    return {
      success: true,
      deletedBillsCount: deletedBills.deletedCount,
      deletedChallansCount: deletedChallans.deletedCount,
      message: `Cleaned slate: ${deletedBills.deletedCount} bills and ${deletedChallans.deletedCount} challans removed.`,
    };
  }
}

module.exports = new OutletBillingService();
