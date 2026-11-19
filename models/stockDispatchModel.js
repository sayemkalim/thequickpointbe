const mongoose = require("mongoose");

const StockDispatchItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    sku: {
      type: String,
      default: "",
      trim: true,
    },
    variant_sku: {
      type: String,
      default: null,
      trim: true,
    },
    unit: {
      type: String,
      default: "pcs",
    },
    hsn: {
      type: String,
      default: "",
    },
    dispatched_quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    received_quantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    wholesale_price: {
      type: Number,
      required: true,
      min: 0,
    },
    total_amount: {
      type: Number,
      required: true,
      min: 0,
    },
    discrepancy_reason: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: true }
);

const StockDispatchSchema = new mongoose.Schema(
  {
    invoice_no: {
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
    status: {
      type: String,
      enum: ["draft", "issued", "partially_received", "received", "cancelled"],
      default: "issued",
      index: true,
    },
    items: [StockDispatchItemSchema],
    total_dispatched_quantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    total_received_quantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    subtotal: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    discount_amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    grand_total: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    dispatched_date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    received_date: {
      type: Date,
      default: null,
    },
    dispatched_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    dispatched_by_name: {
      type: String,
      default: "Central Warehouse Admin",
    },
    received_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    received_by_name: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    cancellation_reason: {
      type: String,
      default: "",
      trim: true,
    },
    // Financial ledger integration guard
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
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

StockDispatchSchema.index({ franchise: 1, createdAt: -1 });
StockDispatchSchema.index({ status: 1, dispatched_date: -1 });

const StockDispatch = mongoose.model("StockDispatch", StockDispatchSchema);

module.exports = StockDispatch;
