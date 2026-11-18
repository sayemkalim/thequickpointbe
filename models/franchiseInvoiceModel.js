const mongoose = require("mongoose");

const FranchiseInvoiceSchema = new mongoose.Schema(
  {
    invoice_no: {
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
        },
        name: { type: String, required: true },
        sku: { type: String, default: "" },
        unit: { type: String, default: "pcs" },
        hsn: { type: String, default: "" },
        quantity: { type: Number, required: true },
        price_per_unit: { type: Number, required: true },
        discount_percent: { type: Number, default: 15 },
        discount_amount: { type: Number, default: 0 },
        total_amount: { type: Number, required: true },
      },
    ],
    total_quantity: { type: Number, default: 0 },
    sub_total: { type: Number, default: 0 },
    discount_amount: { type: Number, default: 0 },
    total_amount: { type: Number, required: true },
    payment_type: { type: String, default: "Credit" },
    payment_status: {
      type: String,
      enum: ["unpaid", "partially_paid", "paid"],
      default: "unpaid",
    },
    received_amount: { type: Number, default: 0 },
    balance_due: { type: Number, default: 0 },
    notes: { type: String, default: "" },
    created_by_admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    created_by_name: { type: String, default: "" },
  },
  {
    timestamps: true,
  }
);

FranchiseInvoiceSchema.index({ franchise: 1, createdAt: -1 });

module.exports = mongoose.model("FranchiseInvoice", FranchiseInvoiceSchema);
