const mongoose = require("mongoose");

const CommissionLedgerSchema = new mongoose.Schema(
  {
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true, // Guarantees duplicate commission records cannot exist for the same order
    },
    orderNumber: {
      type: Number,
      required: true,
    },
    orderAmount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    totalQuantity: {
      type: Number,
      default: 1,
    },
    commissionType: {
      type: String,
      enum: ["percentage", "fixed_per_piece"],
      required: true,
    },
    commissionRate: {
      type: Number,
      required: true,
    },
    outletCommissionAmount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    platformCommissionAmount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    status: {
      type: String,
      enum: ["accrued", "paid", "cancelled"],
      default: "accrued",
      index: true,
    },
    payoutReference: {
      type: String,
      default: null,
    },
    payoutDate: {
      type: Date,
      default: null,
    },
    breakdown: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        productName: String,
        quantity: Number,
        price: Number,
        rateType: String,
        rateValue: Number,
        outletAmount: Number,
        platformAmount: Number,
      },
    ],
  },
  { timestamps: true }
);

CommissionLedgerSchema.index({ franchise: 1, createdAt: -1 });
CommissionLedgerSchema.index({ status: 1, createdAt: -1 });

const CommissionLedger = mongoose.model(
  "CommissionLedger",
  CommissionLedgerSchema
);

module.exports = CommissionLedger;
