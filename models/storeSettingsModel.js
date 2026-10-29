const mongoose = require("mongoose");

const CommissionAuditLogSchema = new mongoose.Schema(
  {
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      default: null, // null means global store setting change
    },
    changeType: {
      type: String,
      enum: ["global_commission", "franchise_commission", "product_commission"],
      required: true,
    },
    previousSetting: {
      type: mongoose.Schema.Types.Mixed,
    },
    newSetting: {
      type: mongoose.Schema.Types.Mixed,
    },
    note: {
      type: String,
      default: "",
    },
    ipAddress: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

const StoreSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "default_dairy_settings",
      unique: true,
    },
    defaultRadiusKm: {
      type: Number,
      default: 15,
      min: 1,
      max: 100,
    },
    commission: {
      type: {
        type: String,
        enum: ["percentage", "fixed_per_piece"],
        default: "percentage",
      },
      value: {
        type: Number,
        default: 10, // 10% or 10 rupees per piece default
        min: 0,
      },
      payoutCycle: {
        type: String,
        enum: ["daily", "weekly", "monthly"],
        default: "weekly",
      },
    },
    paymentGateways: {
      razorpay: {
        enabled: { type: Boolean, default: true },
      },
      cashfree: {
        enabled: { type: Boolean, default: false },
        appId: { type: String, default: null },
        secretKey: { type: String, default: null },
        mode: { type: String, enum: ["TEST", "PROD"], default: "TEST" },
      },
    },
    smsSettings: {
      provider: {
        type: String,
        enum: ["brevo", "fast2sms", "twilio", "mock"],
        default: "mock",
      },
      senderId: { type: String, default: "DAIRY" },
      pickupOtpTemplate: {
        type: String,
        default: "Your dairy pickup OTP for order #{orderNumber} is {otp}. Valid for 2 hours.",
      },
      pickupConfirmedTemplate: {
        type: String,
        default: "Your order #{orderNumber} has been successfully picked up from {outletName}. Thank you!",
      },
    },
    auditLogs: [CommissionAuditLogSchema],
  },
  { timestamps: true }
);

const StoreSettings = mongoose.model("StoreSettings", StoreSettingsSchema);

module.exports = StoreSettings;
