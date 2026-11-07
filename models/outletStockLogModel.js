const mongoose = require("mongoose");

const OutletStockLogSchema = new mongoose.Schema(
  {
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    variant_sku: {
      type: String,
      default: null,
    },
    sku: {
      type: String,
      default: "",
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    type: {
      type: String,
      enum: ["counter_sale", "waste_spoilage", "damage", "adjustment", "other"],
      default: "counter_sale",
      index: true,
    },
    quantity_before: {
      type: Number,
      required: true,
    },
    quantity_after: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      default: "",
      trim: true,
    },
    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    recorded_by_name: {
      type: String,
      default: "",
    },
    recorded_by_role: {
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

OutletStockLogSchema.index({ franchise: 1, createdAt: -1 });
OutletStockLogSchema.index({ product: 1, createdAt: -1 });

const OutletStockLog = mongoose.model("OutletStockLog", OutletStockLogSchema);

module.exports = OutletStockLog;

