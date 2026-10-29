const express = require("express");
const router = express.Router();
const OrderController = require("../../controllers/order/index.js");

// Webhook endpoint for Razorpay payment notifications
// This endpoint should not require authentication as it's called by Razorpay
router.post("/razorpay/payment", OrderController.handlePaymentWebhook);

// Webhook endpoint for Shiprocket tracking & status updates
router.post("/shiprocket", OrderController.handleShiprocketWebhook);

// Optional Webhook endpoint for Cashfree payment notifications
router.post("/cashfree", async (req, res) => {
  try {
    const signature = req.headers["x-webhook-signature"];
    const timestamp = req.headers["x-webhook-timestamp"];
    const CashfreeProvider = require("../../services/payment/cashfreeProvider");
    const DairyOrderService = require("../../services/dairyOrder/index");
    const Order = require("../../models/orderModel");

    const isValid = await CashfreeProvider.verifyWebhookSignature({
      rawBody: req.rawBody || JSON.stringify(req.body),
      signature,
      timestamp,
    });

    if (!isValid) {
      return res.status(400).json({ error: "Invalid Cashfree webhook signature" });
    }

    const event = req.body;
    const orderData = event?.data?.order;
    const paymentData = event?.data?.payment;

    if (orderData?.order_id && event?.type === "PAYMENT_SUCCESS_WEBHOOK") {
      const order = await Order.findById(orderData.order_id);
      if (order && order.paymentStatus !== "paid") {
        await DairyOrderService.confirmOrderPayment(
          order,
          paymentData?.cf_payment_id || `cf_${Date.now()}`,
          "cashfree"
        );
      }
    }

    return res.status(200).json({ success: true, message: "Cashfree webhook processed" });
  } catch (error) {
    console.error("Cashfree webhook processing failed:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;

