const mongoose = require("mongoose");

const FranchiseStockTransferSchema = new mongoose.Schema(
  {
    challan_no: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: { type: String, default: "" },
        sku: { type: String, default: "" },
        unit: { type: String, default: "pcs" },
        quantity: { type: Number, required: true },
        price: { type: Number, default: 0 },
      },
    ],
    total_quantity: { type: Number, default: 0 },
    total_items: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["dispatched", "received", "settled"],
      default: "dispatched",
    },
    dispatched_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    dispatched_by_name: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  {
    timestamps: true,
  }
);

FranchiseStockTransferSchema.index({ franchise: 1, createdAt: -1 });

module.exports = mongoose.model(
  "FranchiseStockTransfer",
  FranchiseStockTransferSchema
);
