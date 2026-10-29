const mongoose = require("mongoose");

const FranchiseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    ownerAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    address: {
      street: { type: String, default: "" },
      locality: { type: String, default: "" },
      city: { type: String, default: "Patna" },
      state: { type: String, default: "Bihar" },
      pincode: { type: String, default: "" },
    },
    // GeoJSON Point for MongoDB 2dsphere spatial indexing
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      // Note: GeoJSON coordinates format is [longitude, latitude]
      coordinates: {
        type: [Number],
        required: true,
        default: [85.1376, 25.5941], // Default coordinates (Patna, Bihar)
      },
    },
    radiusKm: {
      type: Number,
      default: 15,
      min: 1,
      max: 100,
    },
    // Outlet QR code ordering
    qrToken: {
      type: String,
      unique: true,
      sparse: true,
    },
    qrCodeUrl: {
      type: String,
      default: null,
    },
    qrPublicUrl: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "temporary_closed"],
      default: "active",
    },
    // Commission override specific to this franchise
    commissionOverride: {
      enabled: { type: Boolean, default: false },
      type: {
        type: String,
        enum: ["percentage", "fixed_per_piece"],
        default: "percentage",
      },
      value: {
        type: Number,
        default: 10,
        min: 0,
      },
    },
    operatingHours: {
      openingTime: { type: String, default: "06:00" },
      closingTime: { type: String, default: "21:00" },
      daysOpen: {
        type: [String],
        default: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      },
    },
  },
  { timestamps: true }
);

// 2dsphere index for location proximity queries
FranchiseSchema.index({ location: "2dsphere" });
FranchiseSchema.index({ status: 1 });

const Franchise = mongoose.model("Franchise", FranchiseSchema);

module.exports = Franchise;
