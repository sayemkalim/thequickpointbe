const mongoose = require("mongoose");
require("./franchiseModel");
require("./productsModel");
require("./adminModel");

const StockChallanItemSchema = new mongoose.Schema(
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
    receivedQuantity: {
      type: Number,
      default: null,
    },
  },
  { _id: false }
);

const StockChallanSchema = new mongoose.Schema(
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
      type: [StockChallanItemSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "Challan must contain at least one product item.",
      },
    },
    totalQuantity: {
      type: Number,
      required: true,
      default: 0,
    },
    dispatchDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    receivedDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["dispatched", "received", "cancelled"],
      default: "dispatched",
      index: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true }
);

StockChallanSchema.index({ franchise: 1, dispatchDate: -1 });

// Helper static to generate sequential Challan Number (e.g. CH-2611-0001)
StockChallanSchema.statics.generateChallanNumber = async function () {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `CH-${year}${month}-`;

  const latest = await this.findOne({ challanNumber: new RegExp(`^${prefix}`) })
    .sort({ challanNumber: -1 })
    .lean();

  let nextSeq = 1;
  if (latest && latest.challanNumber) {
    const parts = latest.challanNumber.split("-");
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) nextSeq = num + 1;
  }
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
};

const StockChallan = mongoose.model("StockChallan", StockChallanSchema);

module.exports = StockChallan;

