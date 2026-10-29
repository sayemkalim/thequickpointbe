const express = require("express");
const router = express.Router();
const {
  checkout,
  verifyPayment,
  verifyPickupOtp,
  cancelOrder,
  getFranchiseOrders,
  getDairyOrderById,
} = require("../../controllers/dairy/orderController");
const { optionalUser } = require("../../middleware/auth/userMiddleware");
const {
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Customer Checkout (pickup only, address not required)
router.post("/checkout", optionalUser, checkout);

// Payment Verification
router.post("/verify-payment", verifyPayment);

// Outlet Staff Pickup Verification (requires staff auth with outlet check)
router.post("/pickup/verify", franchiseOrAdmin, verifyPickupOtp);

// Order Cancellation
router.post("/:orderId/cancel", cancelOrder);

// Outlet Orders (scoped to franchise owner or central admin)
router.get(
  "/franchise/:franchiseId",
  franchiseOrAdmin,
  scopeToFranchise,
  getFranchiseOrders
);

// Single Order Details
router.get("/:orderId", optionalUser, getDairyOrderById);

module.exports = router;
