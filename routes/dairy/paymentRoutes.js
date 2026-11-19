const express = require("express");
const router = express.Router();
const {
  submitPayment,
  getPayments,
  getPaymentDetails,
  verifyPayment,
  rejectPayment,
} = require("../../controllers/dairy/franchisePaymentController");
const {
  centralAdmin,
  franchiseOrAdmin,
  scopeToFranchise,
} = require("../../middleware/auth/adminMiddleware");

// Submit payment (Franchise owner or Central Admin)
router.post("/", franchiseOrAdmin, scopeToFranchise, submitPayment);

// List payments
router.get("/", franchiseOrAdmin, scopeToFranchise, getPayments);

// Get single payment details
router.get("/:id", franchiseOrAdmin, getPaymentDetails);

// Central Admin verify payment (credits Khata Book)
router.post("/:id/verify", centralAdmin, verifyPayment);

// Central Admin reject payment
router.post("/:id/reject", centralAdmin, rejectPayment);

module.exports = router;

