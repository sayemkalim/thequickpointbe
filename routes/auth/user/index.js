const express = require("express");
const {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  googleLogin,
  sendMobileOtp,
  verifyMobileOtp,
} = require("../../../controllers/auth/user/index");
const { superAdmin } = require("../../../middleware/auth/adminMiddleware");
const {
  otpSendLimiter,
  otpVerifyLimiter,
} = require("../../../middleware/rateLimiter");
const router = express.Router();

// Super Admin: List all users
router.get("/", superAdmin, getAllUsers);

// Customer Mobile OTP Authentication (WebzMedia SMS)
router.post("/send-otp", otpSendLimiter, sendMobileOtp);
router.post("/verify-otp", otpVerifyLimiter, verifyMobileOtp);

// Google OAuth Login
router.post("/google", googleLogin);

// Customer Profile Management
router.get("/:id", getUserById);
router.patch("/:id", updateUser);

// Development / Admin Deletion
router.delete("/:id", deleteUser);

module.exports = router;
