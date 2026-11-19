const mongoose = require("mongoose");

const FranchiseAccountLedgerSchema = new mongoose.Schema(
  {
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: true,
      index: true,
    },
    entry_number: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
      trim: true,
    },
    transaction_type: {
      type: String,
      enum: [
        "stock_invoice",       // Debit (+) Wholesale stock purchase
        "online_settlement",   // Credit (-) Net online customer collection applied to payable
        "franchise_commission",// Informational / Tracking credit
        "franchise_payment",   // Credit (-) Verified bank/cash payment made by franchise
        "refund_reversal",     // Debit (+) or Credit (-) reversal
        "debit_adjustment",    // Debit (+) Adjustment
        "credit_adjustment",   // Credit (-) Adjustment
      ],
      required: true,
      index: true,
    },
    // Amount that INCREASES franchise payable to company
    debit: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    // Amount that DECREASES franchise payable to company
    credit: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    // Running balance: Positive = Franchise owes Company; Negative = Company owes Franchise
    running_balance: {
      type: Number,
      required: true,
    },
    reference_type: {
      type: String,
      enum: ["StockDispatch", "Order", "FranchisePayment", "CounterBill", "Adjustment", "Manual"],
      required: true,
      index: true,
    },
    reference_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    reference_no: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    // Structured metadata snapshot (e.g. gross_online, commission_amount, etc.)
    metadata: {
      gross_online_amount: { type: Number, default: null },
      commission_rate: { type: Number, default: null },
      commission_amount: { type: Number, default: null },
      net_settlement_amount: { type: Number, default: null },
      wholesale_invoice_amount: { type: Number, default: null },
      payment_method: { type: String, default: null },
      transaction_ref: { type: String, default: null },
      notes: { type: String, default: "" },
    },
    transaction_date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    created_by_name: {
      type: String,
      default: "System",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// High-performance compound indexes for ledger queries and statements
FranchiseAccountLedgerSchema.index({ franchise: 1, transaction_date: -1 });
FranchiseAccountLedgerSchema.index({ franchise: 1, createdAt: -1 });
FranchiseAccountLedgerSchema.index({ reference_type: 1, reference_id: 1 });

const FranchiseAccountLedger = mongoose.model(
  "FranchiseAccountLedger",
  FranchiseAccountLedgerSchema
);

module.exports = FranchiseAccountLedger;
