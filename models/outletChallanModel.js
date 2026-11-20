const mongoose = require("mongoose");
require("./franchiseModel");
require("./productsModel");
require("./adminModel");

const OutletChallanItemSchema = new mongoose.Schema(
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
    unit: {
      type: String,
      default: "pcs",
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
      default: 0,
    },
    amount: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { _id: false }
);

const OutletChallanSchema = new mongoose.Schema(
  {
    challanNumber: {
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
    items: {
      type: [OutletChallanItemSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "Challan must contain at least one item.",
      },
    },
    totalQuantity: {
      type: Number,
      required: true,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    dispatchDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "settled", "cancelled"],
      default: "active",
      index: true,
    },
    settlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletBillingSettlement",
      default: null,
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
  },
  { timestamps: true }
);

OutletChallanSchema.index({ franchise: 1, status: 1, dispatchDate: -1 });

// Helper to generate a guaranteed unique Challan Number
OutletChallanSchema.statics.generateChallanNumber = async function () {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const prefix = `CH-${yy}${mm}${dd}-`;

  const count = await this.countDocuments({ challanNumber: new RegExp(`^${prefix}`) });
  let seq = count + 1;
  let candidate = `${prefix}${String(seq).padStart(4, "0")}`;

  while (await this.exists({ challanNumber: candidate })) {
    seq++;
    candidate = `${prefix}${String(seq).padStart(4, "0")}`;
  }
  return candidate;
};

const OutletChallan = mongoose.model("OutletChallan", OutletChallanSchema);

module.exports = OutletChallan;

