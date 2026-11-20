const mongoose = require("mongoose");

const CounterBillItemSchema = new mongoose.Schema(
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
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    selling_price: {
      type: Number,
      required: true,
      min: 0,
    },
    discount_percent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    discount_amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    total_amount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: true }
);

const CustomerPaymentEntrySchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    payment_method: {
      type: String,
      enum: ["cash", "upi", "card", "bank_transfer", "other"],
      required: true,
      default: "cash",
    },
    transaction_reference: {
      type: String,
      default: "",
      trim: true,
    },
    payment_date: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      default: "",
    },
    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    recorded_by_name: {
      type: String,
      default: "",
    },
  },
  { _id: true, timestamps: true }
);

const CounterBillSchema = new mongoose.Schema(
  {
    bill_number: {
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
    customer_name: {
      type: String,
      default: "Walk-in Customer",
      trim: true,
    },
    customer_phone: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    items: [CounterBillItemSchema],
    total_quantity: {
      type: Number,
      required: true,
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
    // Amount collected so far from customer
    received_amount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    // Remaining customer due (Customer receivable for franchise, NOT company payable)
    due_amount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    payment_method: {
      type: String,
      enum: ["cash", "upi", "card", "split", "credit"],
      default: "cash",
    },
    payment_status: {
      type: String,
      enum: ["paid", "partially_paid", "unpaid"],
      default: "paid",
      index: true,
    },
    // Append-only history of customer payments against this bill
    payment_history: [CustomerPaymentEntrySchema],
    bill_date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    billed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    billed_by_name: {
      type: String,
      default: "Outlet Staff",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

CounterBillSchema.index({ franchise: 1, bill_date: -1 });
CounterBillSchema.index({ franchise: 1, payment_status: 1 });

const CounterBill = mongoose.model("CounterBill", CounterBillSchema);

module.exports = CounterBill;

