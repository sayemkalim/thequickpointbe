const mongoose = require("mongoose");

const SettlementStockItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: { type: String, required: true },
    sku: { type: String, default: "" },
    unit: { type: String, default: "pcs" },
    openingStock: { type: Number, default: 0 },
    stockReceived: { type: Number, default: 0 },
    onlineSold: { type: Number, default: 0 },
    walkInSold: { type: Number, default: 0 },
    remainingStock: { type: Number, default: 0 },
  },
  { _id: false }
);

const SettlementPaymentRecordSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    paymentMethod: {
      type: String,
      enum: ["cash", "upi", "bank_transfer", "cheque"],
      default: "upi",
    },
    reference: { type: String, default: "" },
    paymentDate: { type: Date, default: Date.now },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

const FranchiseSettlementSchema = new mongoose.Schema(
  {
    settlementNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
      trim: true,
    },
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: true,
      index: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // Stock Breakdown
    stockSummary: [SettlementStockItemSchema],
    totalStockReceived: { type: Number, default: 0 },
    totalOnlineSold: { type: Number, default: 0 },
    totalWalkInSold: { type: Number, default: 0 },
    totalRemainingStock: { type: Number, default: 0 },

    // Online Sales Overview (Collected by company via Cashfree)
    onlineSalesSummary: {
      totalOrders: { type: Number, default: 0 },
      grossAmount: { type: Number, default: 0 },
      totalQuantity: { type: Number, default: 0 },
    },
    onlineCollectedByCompany: {
      type: Number,
      default: 0,
    },

    // Walk-in Sales Overview (Collected by franchise at counter)
    walkInSalesSummary: {
      totalBills: { type: Number, default: 0 },
      grossAmount: { type: Number, default: 0 },
      totalQuantity: { type: Number, default: 0 },
    },
    walkInGrossAmount: {
      type: Number,
      required: true,
      default: 0,
    },

    // Commission snapshot
    commissionPercentage: {
      type: Number,
      required: true,
      default: 10,
    },
    commissionAmount: {
      type: Number,
      required: true,
      default: 0,
    },

    // Net Payable: Walk-in Gross Amount - Commission Amount
    netPayable: {
      type: Number,
      required: true,
      default: 0,
    },

    // Payments received against this settlement
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingAmount: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid"],
      default: "unpaid",
      index: true,
    },
    payments: [SettlementPaymentRecordSchema],

    status: {
      type: String,
      enum: ["preview", "confirmed", "closed"],
      default: "confirmed",
      index: true,
    },
    notes: {
      type: String,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

FranchiseSettlementSchema.index({ franchise: 1, confirmedAt: -1 });

// Helper static to generate sequential Settlement Number (e.g. SET-2611-0001)
FranchiseSettlementSchema.statics.generateSettlementNumber = async function () {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `SET-${year}${month}-`;

  const latest = await this.findOne({ settlementNumber: new RegExp(`^${prefix}`) })
    .sort({ settlementNumber: -1 })
    .lean();

  let nextSeq = 1;
  if (latest && latest.settlementNumber) {
    const parts = latest.settlementNumber.split("-");
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) nextSeq = num + 1;
  }
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
};

const FranchiseSettlement = mongoose.model(
  "FranchiseSettlement",
  FranchiseSettlementSchema
);

module.exports = FranchiseSettlement;

