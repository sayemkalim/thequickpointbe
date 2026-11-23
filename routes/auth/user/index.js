const express = require("express");
const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  googleLogin,
  sendMobileOtp,
  verifyMobileOtp,
} = require("../../../controllers/auth/user/index");
const { centralAdmin } = require("../../../middleware/auth/adminMiddleware");
const {
  otpSendLimiter,
  otpVerifyLimiter,
} = require("../../../middleware/rateLimiter");
const router = express.Router();

// Admin / Super Admin: List all users
router.get("/", centralAdmin, getAllUsers);
router.post("/", centralAdmin, createUser);

// Customer Mobile OTP Authentication (WebzMedia SMS)
router.post("/send-otp", otpSendLimiter, sendMobileOtp);
router.post("/verify-otp", otpVerifyLimiter, verifyMobileOtp);

// Google OAuth Login
router.post("/google", googleLogin);

// Customer Profile Management
router.get("/:id", getUserById);
router.patch("/:id", updateUser);
router.put("/:id", updateUser);

// Admin Deletion
router.delete("/:id", centralAdmin, deleteUser);

module.exports = router;
