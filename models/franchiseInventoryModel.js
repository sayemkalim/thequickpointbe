const mongoose = require("mongoose");

const FranchiseInventorySchema = new mongoose.Schema(
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
      required: true,
      trim: true,
    },
    quantity_on_hand: {
      type: Number,
      default: 0,
      min: 0,
    },
    reserved_quantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    low_stock_threshold: {
      type: Number,
      default: 10,
      min: 0,
    },
    last_restocked_at: {
      type: Date,
      default: null,
    },
    updated_by_admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for available quantity
FranchiseInventorySchema.virtual("available_quantity").get(function () {
  return Math.max(0, (this.quantity_on_hand || 0) - (this.reserved_quantity || 0));
});

// Ensure a single record per franchise + product + variant
FranchiseInventorySchema.index(
  { franchise: 1, product: 1, variant_sku: 1 },
  { unique: true }
);

FranchiseInventorySchema.index({ franchise: 1, sku: 1 });

const FranchiseInventory = mongoose.model(
  "FranchiseInventory",
  FranchiseInventorySchema
);

module.exports = FranchiseInventory;
