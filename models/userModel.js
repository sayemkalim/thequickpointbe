const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: false },
    email: {
      type: String,
      required: false, // Optional — collected during profile update, not required
      unique: true,
      sparse: true, // Allows multiple users with no email
    },
    phone: {
      type: String,
      required: false, // Not required at schema level so Google-only users work
      unique: true,
      sparse: true,
    },
    // Google OAuth fields
    googleId: { type: String, unique: true, sparse: true },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    profilePicture: { type: String, default: null },
    // Customer Mobile OTP Authentication fields (SMS via WebzMedia)
    mobileOtp: { type: String, default: null },
    mobileOtpExpires: { type: Date, default: null },
    mobileOtpAttempts: { type: Number, default: 0 },
    mobileOtpWindowStart: { type: Date, default: null },
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);
module.exports = User;
