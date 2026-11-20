const mongoose = require("mongoose");
require("./franchiseModel");
require("./productsModel");
require("./adminModel");

const BillingPaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ["cash", "upi", "bank_transfer", "cheque", "other"],
      default: "cash",
    },
    reference: { type: String, default: "" },
    date: { type: Date, default: Date.now },
    notes: { type: String, default: "" },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { _id: true }
);

const ProductMovementBreakdownSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    name: { type: String, default: "" },
    sku: { type: String, default: "" },
    price: { type: Number, default: 0 },
    dispatchedQty: { type: Number, default: 0 },
    onlineSoldQty: { type: Number, default: 0 },
    offlineSoldQty: { type: Number, default: 0 },
    totalSoldQty: { type: Number, default: 0 },
    remainingQty: { type: Number, default: 0 },
  },
  { _id: false }
);

const OutletBillingSettlementSchema = new mongoose.Schema(
  {
    billNumber: {
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
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    challans: [
      {
        challanId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "OutletChallan",
        },
        challanNumber: { type: String },
        amount: { type: Number, default: 0 },
        totalQuantity: { type: Number, default: 0 },
        dispatchDate: { type: Date },
      },
    ],
    // 1. Total Challan Amount (Outlet par Udhar)
    totalChallanAmount: { type: Number, required: true, default: 0 },

    // 2. Online Sales (Direct to Company via Cashfree - 100% Minus from Challan)
    onlineSalesCount: { type: Number, default: 0 },
    onlineSalesAmount: { type: Number, required: true, default: 0 },

    // Walk-in Counter Sales Info
    walkInBillsCount: { type: Number, default: 0 },
    walkInSalesAmount: { type: Number, default: 0 },

    // 3. Rest Amount = Challan Bill - Online Sales
    restAmount: { type: Number, required: true, default: 0 },

    // 4. Franchise Commission % and Amount
    commissionPercentage: { type: Number, required: true, default: 10 },
    commissionAmount: { type: Number, required: true, default: 0 },

    // 5. Final Net Payable (Outlet Owner Dega) = Rest Amount - Commission Amount
    netPayable: { type: Number, required: true, default: 0 },

    // Product Movement Breakdown
    productBreakdown: [ProductMovementBreakdownSchema],

    // Payment Tracking
    amountPaid: { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid"],
      default: "unpaid",
      index: true,
    },
    payments: [BillingPaymentSchema],

    notes: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true }
);

OutletBillingSettlementSchema.index({ franchise: 1, createdAt: -1 });

OutletBillingSettlementSchema.statics.generateBillNumber = async function () {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const prefix = `BILL-${yy}${mm}${dd}-`;

  const count = await this.countDocuments({ billNumber: new RegExp(`^${prefix}`) });
  let seq = count + 1;
  let candidate = `${prefix}${String(seq).padStart(4, "0")}`;

  while (await this.exists({ billNumber: candidate })) {
    seq++;
    candidate = `${prefix}${String(seq).padStart(4, "0")}`;
  }
  return candidate;
};

const OutletBillingSettlement = mongoose.model(
  "OutletBillingSettlement",
  OutletBillingSettlementSchema
);

module.exports = OutletBillingSettlement;
