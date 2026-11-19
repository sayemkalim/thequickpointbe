const mongoose = require("mongoose");
const FranchisePayment = require("../../models/franchisePaymentModel");
const Franchise = require("../../models/franchiseModel");
const FranchiseLedgerService = require("../franchiseLedger/index");

class FranchisePaymentService {
  /**
   * Generates a unique sequential payment number
   */
  async generatePaymentNumber() {
    const yearMonth = new Date().toISOString().slice(2, 7).replace("-", ""); // e.g. 2411
    const count = await FranchisePayment.countDocuments({
      payment_number: new RegExp(`^FPAY-${yearMonth}`),
    });
    const seq = String(count + 1).padStart(4, "0");
    return `FPAY-${yearMonth}-${seq}`;
  }

  /**
   * Submits a payment from a franchise to the company
   */
  async submitPayment({
    franchiseId,
    amount,
    paymentMethod = "upi",
    transactionReference = "",
    proofUrl = null,
    notes = "",
    paymentDate = new Date(),
    admin,
  }) {
    if (!franchiseId) {
      throw new Error("Franchise is required.");
    }

    const safeAmount = Math.max(0, Number(amount) || 0);
    if (safeAmount <= 0) {
      throw new Error("Payment amount must be greater than zero.");
    }

    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) {
      throw new Error("Franchise outlet not found.");
    }

    // Role check: Franchise owner can only submit for their own outlet
    if (admin.role === "franchise_owner") {
      if (String(admin.franchise) !== String(franchiseId)) {
        throw new Error("Access denied: You are only authorized to submit payments for your own outlet.");
      }
    }

    const paymentNumber = await this.generatePaymentNumber();

    const payment = await FranchisePayment.create({
      payment_number: paymentNumber,
      franchise: franchiseId,
      amount: safeAmount,
      payment_method: paymentMethod,
      transaction_reference: transactionReference,
      proof_url: proofUrl,
      notes: notes || "",
      payment_date: paymentDate ? new Date(paymentDate) : new Date(),
      status: "pending",
      submitted_by: admin?._id || null,
      submitted_by_name: admin?.name || "Franchise Owner",
    });

    return payment;
  }

  /**
   * Verifies a pending franchise payment and posts Credit entry to Khata Book
   * Only Super Admin / Central Admin can verify payments
   */
  async verifyPayment({ paymentId, admin }) {
    if (!["super_admin", "admin"].includes(admin.role)) {
      throw new Error("Access denied: Only central administrators can verify franchise payments.");
    }

    const payment = await FranchisePayment.findById(paymentId);
    if (!payment) {
      throw new Error("Franchise payment record not found.");
    }

    if (payment.status === "verified") {
      throw new Error(`Payment #${payment.payment_number} has already been verified.`);
    }

    payment.status = "verified";
    payment.verified_by = admin._id;
    payment.verified_by_name = admin.name || "Central Admin";
    payment.verified_at = new Date();

    // Atomically post Credit entry to FranchiseAccountLedger
    const ledgerEntry = await FranchiseLedgerService.recordFranchisePaymentCredit(payment, admin);

    return {
      success: true,
      payment,
      ledgerEntry,
    };
  }

  /**
   * Rejects a franchise payment submission
   */
  async rejectPayment({ paymentId, rejectionReason = "", admin }) {
    if (!["super_admin", "admin"].includes(admin.role)) {
      throw new Error("Access denied: Only central administrators can reject franchise payments.");
    }

    const payment = await FranchisePayment.findById(paymentId);
    if (!payment) {
      throw new Error("Franchise payment record not found.");
    }

    if (payment.status === "verified") {
      throw new Error("Cannot reject an already verified payment. Use a debit adjustment instead.");
    }

    payment.status = "rejected";
    payment.verified_by = admin._id;
    payment.verified_by_name = admin.name || "Central Admin";
    payment.verified_at = new Date();
    payment.rejection_reason = rejectionReason || "Rejected by administrator";
    await payment.save();

    return payment;
  }

  /**
   * Lists franchise payments with filters and pagination
   */
  async getPayments({
    franchiseId,
    status,
    paymentMethod,
    startDate,
    endDate,
    search,
    limit = 20,
    page = 1,
  }) {
    const match = {};

    if (franchiseId) {
      match.franchise = new mongoose.Types.ObjectId(franchiseId);
    }

    if (status) {
      match.status = status;
    }

    if (paymentMethod) {
      match.payment_method = paymentMethod;
    }

    if (search) {
      match.$or = [
        { payment_number: new RegExp(search.trim(), "i") },
        { transaction_reference: new RegExp(search.trim(), "i") },
      ];
    }

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = eDate;
    }
    if (Object.keys(dateFilter).length > 0) {
      match.payment_date = dateFilter;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [payments, totalCount] = await Promise.all([
      FranchisePayment.find(match)
        .populate("franchise", "name code phone address")
        .populate("verified_by", "name email")
        .populate("submitted_by", "name email")
        .sort({ payment_date: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      FranchisePayment.countDocuments(match),
    ]);

    return {
      payments,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(totalCount / Number(limit)),
      },
    };
  }

  /**
   * Gets details of a single payment
   */
  async getPaymentDetails(paymentId) {
    const payment = await FranchisePayment.findById(paymentId)
      .populate("franchise", "name code phone email address")
      .populate("verified_by", "name email role")
      .populate("submitted_by", "name email role")
      .populate("ledger_entry")
      .lean();

    if (!payment) {
      throw new Error("Payment record not found.");
    }

    return payment;
  }
}

module.exports = new FranchisePaymentService();
