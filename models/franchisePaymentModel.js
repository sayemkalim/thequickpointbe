const mongoose = require("mongoose");

const FranchisePaymentSchema = new mongoose.Schema(
  {
    payment_number: {
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
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    payment_method: {
      type: String,
      enum: ["cash", "upi", "bank_transfer", "cheque", "other"],
      required: true,
      default: "upi",
    },
    transaction_reference: {
      type: String,
      default: "",
      trim: true,
    },
    payment_date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    proof_url: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
      index: true,
    },
    verified_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    verified_by_name: {
      type: String,
      default: "",
    },
    verified_at: {
      type: Date,
      default: null,
    },
    rejection_reason: {
      type: String,
      default: "",
      trim: true,
    },
    is_posted_to_ledger: {
      type: Boolean,
      default: false,
      index: true,
    },
    ledger_entry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FranchiseAccountLedger",
      default: null,
    },
    submitted_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    submitted_by_name: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

FranchisePaymentSchema.index({ franchise: 1, createdAt: -1 });
FranchisePaymentSchema.index({ status: 1, payment_date: -1 });

const FranchisePayment = mongoose.model(
  "FranchisePayment",
  FranchisePaymentSchema
);

module.exports = FranchisePayment;

