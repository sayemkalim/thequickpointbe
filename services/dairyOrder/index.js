const mongoose = require("mongoose");
const Order = require("../../models/orderModel");
const Franchise = require("../../models/franchiseModel");
const Product = require("../../models/productsModel");
const Counter = require("../../models/counterModel");
const FranchiseInventoryService = require("../franchiseInventory/index");
const CommissionService = require("../commission/index");
const SmsService = require("../sms/index");
const razorpay = require("../../config/razorpay");
const CashfreeProvider = require("../payment/cashfreeProvider");

class DairyOrderService {
  /**
   * Generates a 6-digit numeric OTP for pickup
   */
  generatePickupOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Create Dairy Order with Safe Atomic Inventory Reservation
   */
  async createDairyOrder({
    franchiseId,
    items,
    paymentGateway = "razorpay",
    user = null,
    customerName,
    customerPhone,
    customerEmail = null,
    isQrLocked = false,
    fulfillmentType = "pickup",
    address = null,
    shippingCost = 0,
  }) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("Order items are required.");
    }
    if (!customerPhone) {
      throw new Error("Customer phone number is required.");
    }

    let franchise = null;
    if (franchiseId) {
      franchise = await Franchise.findById(franchiseId);
    }
    if (!franchise) {
      franchise = await Franchise.findOne({ status: "active" });
    }
    if (!franchise) {
      throw new Error("No active outlet available to fulfill order.");
    }

    // 1. Resolve and validate items
    const orderItems = [];
    let calculatedTotalAmount = 0;

    for (const item of items) {
      const productId = item.productId || item.product;
      const qty = Number(item.quantity || 1);
      if (qty <= 0) throw new Error("Invalid quantity specified.");

      const product = await Product.findById(productId).lean();
      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }

      // Resolve price
      let unitPrice = Number(product.discounted_price || product.price);
      if (item.variant_sku && Array.isArray(product.variants)) {
        const variant = product.variants.find((v) => v.sku === item.variant_sku);
        if (variant) {
          unitPrice = Number(variant.discounted_price || variant.price);
        }
      }

      const itemTotal = unitPrice * qty;
      calculatedTotalAmount += itemTotal;

      orderItems.push({
        type: "product",
        product: {
          _id: product._id,
          name: product.name,
          price: product.price,
          discounted_price: product.discounted_price,
          banner_image: product.banner_image,
          isDairy: product.isDairy,
          unit: product.unit,
        },
        variant_sku: item.variant_sku || null,
        quantity: qty,
        total_amount: itemTotal,
        discounted_total_amount: itemTotal,
      });
    }

    // 2. Safe Atomic Inventory Reservation at Outlet
    await FranchiseInventoryService.reserveStockForOrder(franchise._id, items);

    // 3. Sequential orderNumber generation
    const counter = await Counter.findByIdAndUpdate(
      { _id: "orderNumber" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const orderNumber = counter.seq;

    // 4. Generate Pickup OTP (valid for 24 hours)
    const pickupOtp = this.generatePickupOtp();
    const pickupOtpExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Format delivery address with street and normalized fields
    let formattedAddress = null;
    if (fulfillmentType === "delivery" && address) {
      const streetVal =
        address.street ||
        address.address_line ||
        address.address ||
        address.locality ||
        "";
      formattedAddress = {
        name: address.name || customerName || user?.name || "Customer",
        mobile: address.mobile || address.phone || customerPhone || user?.phone || "",
        street: streetVal,
        address: address.address || streetVal,
        address_line: address.address_line || streetVal,
        locality: address.locality || "",
        city: address.city || "",
        state: address.state || "",
        pincode: address.pincode || address.zip || "",
        landmark: address.landmark || "",
        alternatePhone: address.alternatePhone || address.alternate_phone || "",
        addressType: address.addressType || address.type || "home",
      };
    }

    // 5. Build order object
    const order = new Order({
      orderNumber,
      user: user?._id || null,
      isGuestOrder: !user,
      guestInfo: {
        name: customerName || user?.name || "Customer",
        mobile: customerPhone || user?.phone,
        email: customerEmail || user?.email || null,
      },
      items: orderItems,
      fulfillmentType: fulfillmentType === "delivery" ? "delivery" : "pickup",
      franchise: franchise._id,
      address: formattedAddress,
      totalAmount: calculatedTotalAmount,
      discountedTotalAmount: calculatedTotalAmount,
      finalTotalAmount: calculatedTotalAmount + (fulfillmentType === "delivery" ? Number(shippingCost || 0) : 0),
      shippingCost: fulfillmentType === "delivery" ? Number(shippingCost || 0) : 0,
      status: "pending",
      paymentStatus: "pending",
      paymentMode: "ONLINE",
      pickupStatus: fulfillmentType === "delivery" ? "ready_for_pickup" : "pending",
      pickupOtp: fulfillmentType === "delivery" ? null : pickupOtp,
      pickupOtpExpires: fulfillmentType === "delivery" ? null : pickupOtpExpires,
    });

    // 6. Calculate immutable commission snapshot
    const commissionSnapshot = await CommissionService.calculateOrderCommission(
      order,
      franchise
    );
    order.commissionSnapshot = commissionSnapshot;

    // 7. Initialize Payment Gateway Order
    let gatewayOrderDetails = null;

    if (paymentGateway === "cashfree" || !paymentGateway) {
      const isCfEnabled = await CashfreeProvider.isEnabled();
      if (isCfEnabled) {
        gatewayOrderDetails = await CashfreeProvider.createPaymentSession({
          orderId: order._id,
          orderAmount: order.finalTotalAmount || calculatedTotalAmount,
          customerId: user?._id ? String(user._id) : `CUST_${customerPhone}`,
          customerPhone,
          customerEmail,
        });
        if (gatewayOrderDetails) {
          gatewayOrderDetails.provider = "cashfree";
          order.cashfreeOrderId =
            gatewayOrderDetails.cf_order_id ||
            gatewayOrderDetails.order_id ||
            gatewayOrderDetails.cfOrderId;
        }
      }
    }

    // Fallback or default to Razorpay
    if (!gatewayOrderDetails && razorpay) {
      if (process.env.NODE_ENV === "test") {
        order.razorpayOrderId = `order_test_${orderNumber}`;
        gatewayOrderDetails = {
          provider: "razorpay",
          razorpayOrderId: order.razorpayOrderId,
          amount: Math.round((order.finalTotalAmount || calculatedTotalAmount) * 100),
          currency: "INR",
          keyId: "rzp_test_key",
        };
      } else {
        try {
          const razorpayOrder = await razorpay.orders.create({
            amount: Math.round((order.finalTotalAmount || calculatedTotalAmount) * 100), // in paise
            currency: "INR",
            receipt: `dairy_rcpt_${orderNumber}`,
            notes: {
              orderId: String(order._id),
              orderNumber: String(orderNumber),
              franchiseId: String(franchise._id),
              fulfillmentType: fulfillmentType || "pickup",
            },
          });
          order.razorpayOrderId = razorpayOrder.id;
          gatewayOrderDetails = {
            provider: "razorpay",
            razorpayOrderId: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            keyId: process.env.RAZORPAY_KEY_ID || "rzp_test",
          };
        } catch (rzpErr) {
          // Rollback stock reservation on gateway initiation failure
          await FranchiseInventoryService.releaseReservedStock(franchise._id, items);
          throw new Error(
            `Payment gateway order creation failed: ${rzpErr.error?.description || rzpErr.message}`
          );
        }
      }
    }

    await order.save();

    return {
      order,
      gatewayDetails: gatewayOrderDetails,
    };
  }

  /**
   * Finalize Payment for Dairy Order
   */
  async confirmOrderPayment(order, paymentId, paymentMethod = "online") {
    if (order.paymentStatus === "paid") {
      return order; // Idempotent
    }

    order.paymentStatus = "paid";
    order.paymentId = paymentId;
    order.paymentMethod = paymentMethod;
    order.status = "confirmed";
    order.pickupStatus = "ready_for_pickup";
    order.paidAt = new Date();
    await order.save();

    // Populate franchise for SMS
    const franchise = await Franchise.findById(order.franchise);
    const outletName = franchise?.name || "your selected dairy outlet";
    const phone = order.guestInfo?.mobile || order.user?.phone;

    // Send pickup OTP SMS to customer
    if (phone && order.pickupOtp) {
      try {
        await SmsService.sendPickupOtp({
          phone,
          orderNumber: order.orderNumber,
          otp: order.pickupOtp,
          outletName,
        });
      } catch (smsErr) {
        console.error("Pickup OTP SMS error:", smsErr.message);
      }
    }

    return order;
  }

  /**
   * Cancel Dairy Order and Release Reserved Stock
   */
  async cancelDairyOrder(orderId, reason = "Payment cancelled or failed") {
    const order = await Order.findById(orderId);
    if (!order) throw new Error("Order not found");

    if (order.pickupStatus === "picked_up") {
      throw new Error("Cannot cancel an order that has already been picked up.");
    }

    if (order.status === "cancelled") {
      return order; // Already cancelled
    }

    // Release reserved inventory
    if (order.franchise && order.items && order.items.length > 0) {
      await FranchiseInventoryService.releaseReservedStock(
        order.franchise,
        order.items
      );
    }

    order.status = "cancelled";
    order.pickupStatus = "cancelled";
    if (order.paymentStatus === "pending") {
      order.paymentStatus = "cancelled";
    }
    await order.save();
    return order;
  }

  /**
   * Staff Pickup OTP Verification
   * Guarantees duplicate pickup and duplicate commission prevention
   */
  async verifyPickupOtp({ orderId, orderNumber, otp, staffAdmin }) {
    if (!otp) throw new Error("Pickup OTP is required");

    const query = {};
    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      query._id = orderId;
    } else if (orderNumber) {
      query.orderNumber = Number(orderNumber);
    } else {
      throw new Error("Valid orderId or orderNumber is required");
    }

    const order = await Order.findOne(query);
    if (!order) {
      throw new Error("Dairy order not found");
    }

    // 1. Outlet Authorization Check
    const staffRole = staffAdmin.role;
    const isCentralAdmin = ["super_admin", "admin"].includes(staffRole);

    if (!isCentralAdmin) {
      if (
        !staffAdmin.franchise ||
        String(staffAdmin.franchise) !== String(order.franchise)
      ) {
        throw new Error("Access denied: You are only authorized to verify pickups for your own outlet.");
      }
    }

    // 2. Check if already picked up (Duplicate Pickup Prevention)
    if (order.pickupStatus === "picked_up") {
      return {
        alreadyPickedUp: true,
        success: false,
        message: `Order #${order.orderNumber} was already picked up on ${order.pickedUpAt ? new Date(order.pickedUpAt).toLocaleString() : "earlier"}.`,
        order,
      };
    }

    // 3. Verify OTP
    if (order.pickupOtp !== String(otp).trim()) {
      throw new Error("Invalid Pickup OTP. Please check and try again.");
    }

    // Check OTP expiry
    if (order.pickupOtpExpires && new Date() > new Date(order.pickupOtpExpires)) {
      throw new Error("Pickup OTP has expired. Please contact outlet support.");
    }

    // 4. Atomic Pickup Status Update
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        pickupStatus: { $ne: "picked_up" }, // Ensures atomic single-execution
      },
      {
        $set: {
          pickupStatus: "picked_up",
          status: "delivered",
          pickedUpAt: new Date(),
          pickedUpByStaff: staffAdmin._id,
        },
      },
      { new: true }
    );

    if (!updatedOrder) {
      throw new Error("Order was already picked up in a concurrent request.");
    }

    // 5. Commit reserved inventory deduction
    try {
      await FranchiseInventoryService.commitReservedStock(
        updatedOrder.franchise,
        updatedOrder.items
      );
    } catch (invErr) {
      console.error("Failed to commit reserved stock on pickup:", invErr.message);
    }

    // 6. Record immutable Commission Ledger (Duplicate-Safe)
    let commissionRecord = null;
    try {
      commissionRecord = await CommissionService.recordCommissionLedger(updatedOrder);
    } catch (commErr) {
      console.error("Commission ledger recording error:", commErr.message);
    }

    // 7. Send Customer Confirmation SMS
    const franchise = await Franchise.findById(updatedOrder.franchise);
    const outletName = franchise?.name || "the outlet";
    const phone = updatedOrder.guestInfo?.mobile || updatedOrder.user?.phone;

    if (phone) {
      try {
        await SmsService.sendPickupConfirmation({
          phone,
          orderNumber: updatedOrder.orderNumber,
          outletName,
        });
      } catch (smsErr) {
        console.error("Pickup confirmation SMS error:", smsErr.message);
      }
    }

    return {
      success: true,
      message: "Pickup OTP verified successfully. Order marked as delivered.",
      order: updatedOrder,
      commissionRecord,
    };
  }
}

module.exports = new DairyOrderService();
