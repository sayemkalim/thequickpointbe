const mongoose = require("mongoose");

const RewardTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["earned", "redeemed", "refunded", "adjusted"],
      required: true,
    },
    points: {
      type: Number,
      required: true,
    },
    amount: {
      type: Number, // Rupee equivalent (1 point = ₹1)
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    orderNumber: {
      type: String,
      default: null,
    },
    description: {
      type: String,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

const RewardTransaction = mongoose.model(
  "RewardTransaction",
  RewardTransactionSchema
);
module.exports = RewardTransaction;
