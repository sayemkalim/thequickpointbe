const mongoose = require("mongoose");
const FranchiseAccountLedger = require("../../models/franchiseAccountLedgerModel");
const Franchise = require("../../models/franchiseModel");

class FranchiseLedgerService {
  /**
   * Generates a unique sequential/timestamped ledger entry number
   */
  generateEntryNumber() {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(1000 + Math.random() * 9000);
    return `TXN-${timestamp}-${random}`;
  }

  /**
   * Gets the latest running balance for a franchise
   */
  async getLatestBalance(franchiseId, session = null) {
    const query = FranchiseAccountLedger.findOne({ franchise: franchiseId })
      .sort({ transaction_date: -1, createdAt: -1 });

    if (session) query.session(session);

    const latest = await query.exec();
    return latest ? Number(latest.running_balance || 0) : 0;
  }

  /**
   * Posts an immutable ledger entry and maintains the exact running balance atomically
   */
  async postEntry({
    franchiseId,
    transactionType,
    debit = 0,
    credit = 0,
    referenceType,
    referenceId = null,
    referenceNo = "",
    description,
    metadata = {},
    transactionDate = new Date(),
    admin = null,
    session = null,
  }) {
    const safeDebit = Math.max(0, Number(debit) || 0);
    const safeCredit = Math.max(0, Number(credit) || 0);

    const previousBalance = await this.getLatestBalance(franchiseId, session);
    // Debit increases what franchise owes (+); Credit reduces what franchise owes (-)
    const newBalance = Number((previousBalance + safeDebit - safeCredit).toFixed(2));

    const entryData = {
      franchise: franchiseId,
      entry_number: this.generateEntryNumber(),
      transaction_type: transactionType,
      debit: safeDebit,
      credit: safeCredit,
      running_balance: newBalance,
      reference_type: referenceType,
      reference_id: referenceId,
      reference_no: referenceNo,
      description,
      metadata,
      transaction_date: transactionDate,
      created_by: admin?._id || null,
      created_by_name: admin?.name || "System",
    };

    const options = session ? { session } : {};
    const [entry] = await FranchiseAccountLedger.create([entryData], options);
    return entry;
  }

  /**
   * Posts Debit entry for a confirmed Wholesale Stock Dispatch Invoice
   */
  async recordStockInvoiceDebit(stockDispatch, admin = null, session = null) {
    if (stockDispatch.is_posted_to_ledger) {
      return null; // Idempotency guard
    }

    const amount = Number(stockDispatch.grand_total || 0);
    const entry = await this.postEntry({
      franchiseId: stockDispatch.franchise,
      transactionType: "stock_invoice",
      debit: amount,
      credit: 0,
      referenceType: "StockDispatch",
      referenceId: stockDispatch._id,
      referenceNo: stockDispatch.invoice_no,
      description: `Wholesale stock purchase invoice #${stockDispatch.invoice_no} (${stockDispatch.total_received_quantity || stockDispatch.total_dispatched_quantity} pcs)`,
      metadata: {
        wholesale_invoice_amount: amount,
        notes: stockDispatch.notes,
      },
      transactionDate: stockDispatch.received_date || stockDispatch.dispatched_date || new Date(),
      admin,
      session,
    });

    stockDispatch.is_posted_to_ledger = true;
    stockDispatch.ledger_entry = entry._id;
    await stockDispatch.save({ session });

    return entry;
  }

  /**
   * Posts Credit entry for Online Sale Net Settlement
   * Net Online Settlement = Online Amount Collected - Franchise Commission
   */
  async recordOnlineSaleSettlement({
    order,
    commissionResult,
    admin = null,
    session = null,
  }) {
    // Check if this order was already posted to prevent duplicate settlement
    const existing = await FranchiseAccountLedger.findOne({
      reference_type: "Order",
      reference_id: order._id,
      transaction_type: "online_settlement",
    }).session(session || null);

    if (existing) {
      return existing; // Idempotent
    }

    const grossOnline = Number(order.totalAmount || 0);
    const commissionAmount = Number(commissionResult?.outletCommissionAmount || 0);
    const netSettlement = Math.max(0, Number((grossOnline - commissionAmount).toFixed(2)));

    const entry = await this.postEntry({
      franchiseId: order.franchise,
      transactionType: "online_settlement",
      debit: 0,
      credit: netSettlement,
      referenceType: "Order",
      referenceId: order._id,
      referenceNo: String(order.orderNumber || order._id),
      description: `Online sale net settlement for Order #${order.orderNumber} (Gross: ₹${grossOnline.toFixed(2)}, Commission: ₹${commissionAmount.toFixed(2)})`,
      metadata: {
        gross_online_amount: grossOnline,
        commission_rate: Number(commissionResult?.commissionRate || 0),
        commission_amount: commissionAmount,
        net_settlement_amount: netSettlement,
        payment_method: "cashfree",
      },
      transactionDate: order.paidAt || order.pickedUpAt || new Date(),
      admin,
      session,
    });

    return entry;
  }

  /**
   * Posts Credit entry for a verified Franchise Payment to Company
   */
  async recordFranchisePaymentCredit(payment, admin = null, session = null) {
    if (payment.is_posted_to_ledger) {
      return null; // Idempotency guard
    }

    const amount = Number(payment.amount || 0);
    const entry = await this.postEntry({
      franchiseId: payment.franchise,
      transactionType: "franchise_payment",
      debit: 0,
      credit: amount,
      referenceType: "FranchisePayment",
      referenceId: payment._id,
      referenceNo: payment.payment_number,
      description: `Franchise payment verified #${payment.payment_number} via ${payment.payment_method.toUpperCase()} (Ref: ${payment.transaction_reference || "N/A"})`,
      metadata: {
        payment_method: payment.payment_method,
        transaction_ref: payment.transaction_reference,
        notes: payment.notes,
      },
      transactionDate: payment.verified_at || payment.payment_date || new Date(),
      admin,
      session,
    });

    payment.is_posted_to_ledger = true;
    payment.ledger_entry = entry._id;
    await payment.save({ session });

    return entry;
  }

  /**
   * Posts a manual Debit or Credit adjustment
   */
  async recordManualAdjustment({
    franchiseId,
    adjustmentType, // "debit_adjustment" or "credit_adjustment"
    amount,
    reason,
    referenceNo = "",
    admin,
    session = null,
  }) {
    const safeAmount = Math.max(0, Number(amount) || 0);
    if (safeAmount <= 0) {
      throw new Error("Adjustment amount must be greater than zero.");
    }

    const isDebit = adjustmentType === "debit_adjustment";
    const debit = isDebit ? safeAmount : 0;
    const credit = !isDebit ? safeAmount : 0;

    const entry = await this.postEntry({
      franchiseId,
      transactionType: adjustmentType,
      debit,
      credit,
      referenceType: "Adjustment",
      referenceNo: referenceNo || `ADJ-${Date.now().toString().slice(-4)}`,
      description: `Manual ${isDebit ? "Debit" : "Credit"} adjustment: ${reason}`,
      metadata: {
        notes: reason,
      },
      admin,
      session,
    });

    return entry;
  }

  /**
   * Comprehensive franchise account summary calculation
   * Formulas:
   * Net Online Settlement = Online Amount Collected - Franchise Commission
   * Outstanding Payable = Wholesale Stock Invoice Amount - Net Online Settlement - Verified Franchise Payments + Debit Adjustments - Credit Adjustments
   */
  async getFranchiseAccountSummary(franchiseId) {
    const franchise = await Franchise.findById(franchiseId).lean();
    if (!franchise) {
      throw new Error("Franchise not found");
    }

    const StockDispatch = require("../../models/stockDispatchModel");
    const FranchisePayment = require("../../models/franchisePaymentModel");
    const CommissionLedger = require("../../models/commissionLedgerModel");
    const CounterBill = require("../../models/counterBillModel");

    // 1. Total Wholesale Stock Dispatched & Received Value
    const stockAggr = await StockDispatch.aggregate([
      { $match: { franchise: new mongoose.Types.ObjectId(franchiseId), status: { $in: ["issued", "received", "partially_received"] } } },
      {
        $group: {
          _id: null,
          totalWholesaleValue: { $sum: "$grand_total" },
          totalDispatchedQty: { $sum: "$total_dispatched_quantity" },
          totalReceivedQty: { $sum: "$total_received_quantity" },
          count: { $sum: 1 },
        },
      },
    ]);
    const stockStats = stockAggr[0] || { totalWholesaleValue: 0, totalDispatchedQty: 0, totalReceivedQty: 0, count: 0 };

    // 2. Total Franchise Payments (Verified & Pending)
    const paymentAggr = await FranchisePayment.aggregate([
      { $match: { franchise: new mongoose.Types.ObjectId(franchiseId) } },
      {
        $group: {
          _id: "$status",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    let totalVerifiedPayments = 0;
    let totalPendingPayments = 0;
    paymentAggr.forEach((p) => {
      if (p._id === "verified") totalVerifiedPayments = p.totalAmount;
      if (p._id === "pending") totalPendingPayments = p.totalAmount;
    });

    // 3. Online Sales & Commission Stats
    const commissionAggr = await CommissionLedger.aggregate([
      { $match: { franchise: new mongoose.Types.ObjectId(franchiseId), status: { $ne: "cancelled" } } },
      {
        $group: {
          _id: null,
          totalOnlineCollected: { $sum: { $toDouble: "$orderAmount" } },
          totalCommissionEarned: { $sum: { $toDouble: "$outletCommissionAmount" } },
          orderCount: { $sum: 1 },
        },
      },
    ]);
    const commissionStats = commissionAggr[0] || { totalOnlineCollected: 0, totalCommissionEarned: 0, orderCount: 0 };

    const netOnlineSettlement = Math.max(
      0,
      Number((commissionStats.totalOnlineCollected - commissionStats.totalCommissionEarned).toFixed(2))
    );

    // 4. Walk-in / POS Sales Stats
    const posAggr = await CounterBill.aggregate([
      { $match: { franchise: new mongoose.Types.ObjectId(franchiseId) } },
      {
        $group: {
          _id: null,
          totalWalkInSales: { $sum: "$grand_total" },
          totalWalkInReceived: { $sum: "$received_amount" },
          totalCustomerDue: { $sum: "$due_amount" },
          billCount: { $sum: 1 },
        },
      },
    ]);
    const posStats = posAggr[0] || { totalWalkInSales: 0, totalWalkInReceived: 0, totalCustomerDue: 0, billCount: 0 };

    // 5. Adjustments from Ledger
    const adjustmentAggr = await FranchiseAccountLedger.aggregate([
      {
        $match: {
          franchise: new mongoose.Types.ObjectId(franchiseId),
          transaction_type: { $in: ["debit_adjustment", "credit_adjustment"] },
        },
      },
      {
        $group: {
          _id: "$transaction_type",
          total: { $sum: { $cond: [{ $eq: ["$transaction_type", "debit_adjustment"] }, "$debit", "$credit"] } },
        },
      },
    ]);

    let debitAdjustments = 0;
    let creditAdjustments = 0;
    adjustmentAggr.forEach((a) => {
      if (a._id === "debit_adjustment") debitAdjustments = a.total;
      if (a._id === "credit_adjustment") creditAdjustments = a.total;
    });

    // Exact Ledger Formula:
    // Outstanding Payable = Wholesale Stock - Net Online Settlement - Verified Payments + Debit Adjustments - Credit Adjustments
    const calculatedOutstanding = Number(
      (
        stockStats.totalWholesaleValue -
        netOnlineSettlement -
        totalVerifiedPayments +
        debitAdjustments -
        creditAdjustments
      ).toFixed(2)
    );

    const latestRunningBalance = await this.getLatestBalance(franchiseId);

    return {
      franchise: {
        _id: franchise._id,
        name: franchise.name,
        code: franchise.code,
        city: franchise.address?.city || "Bihar",
        phone: franchise.phone,
        commissionConfig: franchise.commissionOverride,
      },
      summary: {
        totalWholesaleStockValue: Number(stockStats.totalWholesaleValue.toFixed(2)),
        totalStockPurchasesCount: stockStats.count,
        totalDispatchedQuantity: stockStats.totalDispatchedQty,
        totalReceivedQuantity: stockStats.totalReceivedQty,
        totalOnlineSalesCollected: Number(commissionStats.totalOnlineCollected.toFixed(2)),
        totalFranchiseCommissionEarned: Number(commissionStats.totalCommissionEarned.toFixed(2)),
        netOnlineSettlement: Number(netOnlineSettlement.toFixed(2)),
        totalVerifiedPayments: Number(totalVerifiedPayments.toFixed(2)),
        pendingPayments: Number(totalPendingPayments.toFixed(2)),
        debitAdjustments: Number(debitAdjustments.toFixed(2)),
        creditAdjustments: Number(creditAdjustments.toFixed(2)),
        outstandingPayable: calculatedOutstanding,
        runningBalance: latestRunningBalance,
        // Walk-in POS details (for outlet awareness - not company payable)
        totalWalkInSales: Number(posStats.totalWalkInSales.toFixed(2)),
        totalWalkInReceived: Number(posStats.totalWalkInReceived.toFixed(2)),
        totalCustomerDue: Number(posStats.totalCustomerDue.toFixed(2)),
        walkInBillCount: posStats.billCount,
      },
    };
  }

  /**
   * Returns chronological ledger statement with opening & closing balance and filters
   */
  async getFranchiseStatement({ franchiseId, startDate, endDate, transactionType, limit = 100, page = 1 }) {
    const match = { franchise: new mongoose.Types.ObjectId(franchiseId) };

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = eDate;
    }
    if (Object.keys(dateFilter).length > 0) {
      match.transaction_date = dateFilter;
    }

    if (transactionType) {
      match.transaction_type = transactionType;
    }

    // Opening Balance calculation before startDate
    let openingBalance = 0;
    if (startDate) {
      const priorLast = await FranchiseAccountLedger.findOne({
        franchise: franchiseId,
        transaction_date: { $lt: new Date(startDate) },
      })
        .sort({ transaction_date: -1, createdAt: -1 })
        .lean();

      if (priorLast) {
        openingBalance = Number(priorLast.running_balance || 0);
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [entries, totalCount] = await Promise.all([
      FranchiseAccountLedger.find(match)
        .sort({ transaction_date: 1, createdAt: 1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      FranchiseAccountLedger.countDocuments(match),
    ]);

    const totalDebit = entries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
    const totalCredit = entries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0);

    const closingBalance =
      entries.length > 0
        ? Number(entries[entries.length - 1].running_balance || 0)
        : openingBalance;

    return {
      franchiseId,
      openingBalance: Number(openingBalance.toFixed(2)),
      closingBalance: Number(closingBalance.toFixed(2)),
      totalDebit: Number(totalDebit.toFixed(2)),
      totalCredit: Number(totalCredit.toFixed(2)),
      entries,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(totalCount / Number(limit)),
      },
    };
  }
}

module.exports = new FranchiseLedgerService();
