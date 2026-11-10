const mongoose = require("mongoose");
const Order = require("../../models/orderModel");
const Franchise = require("../../models/franchiseModel");
const Product = require("../../models/productsModel");
const Counter = require("../../models/counterModel");
const FranchiseInventory = require("../../models/franchiseInventoryModel");
const Inventory = require("../../models/inventoryModel");
const FranchiseInventoryService = require("../franchiseInventory/index");
const CommissionService = require("../commission/index");
const SmsService = require("../sms/index");
const razorpay = require("../../config/razorpay");
const CashfreeProvider = require("../payment/cashfreeProvider");
const Coupon = require("../../models/couponModel");
const CouponService = require("../coupon/index");

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
    couponCode = null,
    couponDiscountAmount = 0,
    couponId = null,
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
    if (!franchise && fulfillmentType === "pickup") {
      franchise = await Franchise.findOne({ status: "active" });
    }
    if (!franchise && fulfillmentType === "pickup") {
      throw new Error("No active outlet available to fulfill takeaway order.");
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

    // 2. Safe Atomic Inventory Reservation
    // Rule A: Takeaway (pickup): MUST be available in the chosen outlet's inventory. If not available at outlet -> BLOCK TAKEAWAY!
    // Rule B: Home Delivery: If available at outlet -> fulfill from outlet. If NOT available at outlet -> fulfill from Central Inventory!
    const isPickup = fulfillmentType === "pickup";
    const reservedLogs = [];
    let hasOutletReservation = false;
    let hasCentralReservation = false;

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const productId = item.productId || item.product?._id || item.product;
        const rawVariantSku = item.variant_sku || item.variantSku || null;
        const variantSku =
          !rawVariantSku || rawVariantSku === "base" || rawVariantSku === "null" || rawVariantSku === "undefined"
            ? null
            : rawVariantSku;
        const qty = Number(item.quantity || 1);
        const resolvedProduct = await Product.findById(productId).lean();
        const productName = resolvedProduct?.name || "Item";

        // Check availability at outlet
        let outletInv = null;
        if (franchise?._id) {
          if (variantSku) {
            outletInv = await FranchiseInventory.findOne({
              franchise: franchise._id,
              product: productId,
              variant_sku: variantSku,
            });
          }
          if (!outletInv) {
            outletInv = await FranchiseInventory.findOne({
              franchise: franchise._id,
              product: productId,
              $or: [{ variant_sku: null }, { variant_sku: "" }, { variant_sku: "base" }, { variant_sku: { $exists: false } }],
            });
          }
          if (!outletInv && !variantSku) {
            outletInv = await FranchiseInventory.findOne({
              franchise: franchise._id,
              product: productId,
            });
          }
        }

        const outletAvailable = outletInv
          ? Math.max(0, (outletInv.quantity_on_hand || 0) - (outletInv.reserved_quantity || 0))
          : 0;

        if (isPickup) {
          // --- TAKEAWAY / PICKUP FLOW ---
          // Both isDairy: true and isDairy: false can be taken away if available in the chosen outlet's inventory.
          if (outletAvailable >= qty) {
            const updated = await FranchiseInventory.findOneAndUpdate(
              {
                _id: outletInv._id,
                $expr: {
                  $gte: [
                    { $subtract: ["$quantity_on_hand", "$reserved_quantity"] },
                    qty,
                  ],
                },
              },
              { $inc: { reserved_quantity: qty } },
              { new: true }
            );

            if (!updated) {
              throw new Error(
                `Product "${productName}" is no longer available in the requested quantity for takeaway at this outlet.`
              );
            }

            orderItems[i].inventorySource = "outlet";
            hasOutletReservation = true;
            reservedLogs.push({
              source: "outlet",
              inventoryId: outletInv._id,
              franchiseId: franchise._id,
              productId,
              variantSku,
              quantity: qty,
            });
          } else {
            // Not available at outlet!
            if (resolvedProduct?.isDairy) {
              throw new Error(
                `"${productName}" is out of stock at this outlet for takeaway.`
              );
            } else {
              throw new Error(
                `"${productName}" is out of stock at this outlet for takeaway. Please switch to Home Delivery.`
              );
            }
          }
        } else {
          // --- HOME DELIVERY FLOW ---
          // Rule 1: Dairy products (isDairy: true) can NEVER be ordered via Home Delivery!
          if (resolvedProduct?.isDairy) {
            throw new Error(
              `"${productName}" is a fresh dairy product and is only available for Store Takeaway (Pickup). Home delivery is not supported.`
            );
          }

          // Rule 2: ALL Home Delivery orders are fulfilled strictly from Central Inventory!
          let centralInv = null;
          if (variantSku) {
            centralInv = await Inventory.findOne({
              product: productId,
              variant_sku: variantSku,
            });
          }
          if (!centralInv) {
            centralInv = await Inventory.findOne({
              product: productId,
              $or: [{ variant_sku: null }, { variant_sku: "" }, { variant_sku: "base" }, { variant_sku: { $exists: false } }],
            });
          }
          if (!centralInv && !variantSku) {
            centralInv = await Inventory.findOne({ product: productId });
          }

          const centralAvailable = centralInv
            ? Math.max(0, (centralInv.quantity_on_hand || 0) - (centralInv.reserved_quantity || 0))
            : 0;

          if (centralAvailable >= qty) {
            const centralUpdated = await Inventory.findOneAndUpdate(
              {
                _id: centralInv._id,
                $expr: {
                  $gte: [
                    { $subtract: ["$quantity_on_hand", "$reserved_quantity"] },
                    qty,
                  ],
                },
              },
              { $inc: { reserved_quantity: qty } },
              { new: true }
            );

            if (!centralUpdated) {
              throw new Error(
                `Product "${productName}" is no longer available in Central Inventory for Home Delivery.`
              );
            }

            orderItems[i].inventorySource = "central";
            hasCentralReservation = true;
            reservedLogs.push({
              source: "central",
              inventoryId: centralInv._id,
              productId,
              variantSku,
              quantity: qty,
            });
          } else {
            throw new Error(
              `Insufficient stock for "${productName}" in Central Inventory for Home Delivery. Requested: ${qty}, Available: ${centralAvailable}`
            );
          }
        }
      }
    } catch (resErr) {
      // Rollback any successfully reserved items
      for (const log of reservedLogs) {
        if (log.source === "outlet") {
          await FranchiseInventory.updateOne(
            { _id: log.inventoryId },
            { $inc: { reserved_quantity: -log.quantity } }
          );
        } else if (log.source === "central") {
          await Inventory.updateOne(
            { _id: log.inventoryId },
            { $inc: { reserved_quantity: -log.quantity } }
          );
        }
      }
      throw resErr;
    }

    const orderInventorySource =
      hasOutletReservation && hasCentralReservation
        ? "mixed"
        : hasCentralReservation
        ? "central"
        : "outlet";

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

    // 5. Resolve Coupon & Discount
    let resolvedCouponDoc = null;
    let resolvedCouponId = couponId;
    let resolvedDiscount = Number(couponDiscountAmount || 0);

    if (couponCode) {
      try {
        const cleanCode = String(couponCode).trim().toUpperCase();
        resolvedCouponDoc = await Coupon.findOne({ code: cleanCode, is_active: true });
        if (resolvedCouponDoc) {
          resolvedCouponId = resolvedCouponDoc._id;
          if (resolvedDiscount <= 0 && CouponService?.calculateDiscount) {
            resolvedDiscount = CouponService.calculateDiscount(resolvedCouponDoc, calculatedTotalAmount);
          }
        }
      } catch (err) {
        console.warn("Could not resolve coupon doc in createDairyOrder:", err.message);
      }
    }

    const finalCouponDiscount = Math.max(0, Math.min(calculatedTotalAmount, resolvedDiscount));
    const discountedSubtotal = Math.max(0, calculatedTotalAmount - finalCouponDiscount);
    const finalOrderAmount = Math.max(
      0,
      discountedSubtotal + (fulfillmentType === "delivery" ? Number(shippingCost || 0) : 0)
    );

    // 6. Build order object
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
      inventorySource: orderInventorySource,
      franchise: franchise._id,
      address: formattedAddress,
      totalAmount: calculatedTotalAmount,
      discountedTotalAmount: discountedSubtotal,
      finalTotalAmount: finalOrderAmount,
      shippingCost: fulfillmentType === "delivery" ? Number(shippingCost || 0) : 0,
      coupon: resolvedCouponId || null,
      couponCode: couponCode ? String(couponCode).trim().toUpperCase() : (resolvedCouponDoc ? resolvedCouponDoc.code : null),
      couponDiscountAmount: finalCouponDiscount,
      status: "pending",
      paymentStatus: "pending",
      paymentMode: "ONLINE",
      pickupStatus: fulfillmentType === "delivery" ? "ready_for_pickup" : "pending",
      pickupOtp: fulfillmentType === "delivery" ? null : pickupOtp,
      pickupOtpExpires: fulfillmentType === "delivery" ? null : pickupOtpExpires,
    });

    // 7. Calculate immutable commission snapshot
    const commissionSnapshot = await CommissionService.calculateOrderCommission(
      order,
      franchise
    );
    order.commissionSnapshot = commissionSnapshot;

    // 8. Initialize Payment Gateway Order
    let gatewayOrderDetails = null;

    if (paymentGateway === "cashfree" || !paymentGateway) {
      const isCfEnabled = await CashfreeProvider.isEnabled();
      if (isCfEnabled) {
        gatewayOrderDetails = await CashfreeProvider.createPaymentSession({
          orderId: order._id,
          orderAmount: finalOrderAmount,
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
          amount: Math.round(finalOrderAmount * 100),
          currency: "INR",
          keyId: "rzp_test_key",
        };
      } else {
        try {
          const razorpayOrder = await razorpay.orders.create({
            amount: Math.round(finalOrderAmount * 100), // in paise
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
          await this.releaseOrderStock(order);
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
   * Commit reserved stock on successful payment confirmation
   */
  async commitOrderStock(order) {
    if (!order || !Array.isArray(order.items) || order.items.length === 0) return;
    // For pickup orders, stock remains reserved until customer verifies OTP at outlet
    if (order.fulfillmentType === "pickup") return;
    for (const item of order.items) {
      const productId = item.product?._id || item.product;
      const variantSku = item.variant_sku || null;
      const qty = Number(item.quantity || 1);

      if (item.inventorySource === "central") {
        const query = { product: productId };
        if (variantSku) {
          query.variant_sku = variantSku;
        } else {
          query.$or = [{ variant_sku: null }, { variant_sku: { $exists: false } }];
        }
        await Inventory.updateOne(
          query,
          {
            $inc: {
              quantity_on_hand: -qty,
              reserved_quantity: -qty,
            },
          }
        );
      } else if (order.franchise) {
        const query = { franchise: order.franchise, product: productId };
        if (variantSku) {
          query.variant_sku = variantSku;
        } else {
          query.$or = [{ variant_sku: null }, { variant_sku: { $exists: false } }];
        }
        await FranchiseInventory.updateOne(
          query,
          {
            $inc: {
              quantity_on_hand: -qty,
              reserved_quantity: -qty,
              total_sold_quantity: qty,
              online_sold_quantity: qty,
            },
          }
        );
      }
    }
  }

  /**
   * Release reserved stock back to available pool on cancellation / gateway failure
   */
  async releaseOrderStock(order) {
    if (!order || !Array.isArray(order.items) || order.items.length === 0) return;
    for (const item of order.items) {
      const productId = item.product?._id || item.product;
      const variantSku = item.variant_sku || null;
      const qty = Number(item.quantity || 1);

      if (item.inventorySource === "central") {
        const query = { product: productId };
        if (variantSku) {
          query.variant_sku = variantSku;
        } else {
          query.$or = [{ variant_sku: null }, { variant_sku: { $exists: false } }];
        }
        await Inventory.updateOne(
          query,
          { $inc: { reserved_quantity: -qty } }
        );
      } else if (order.franchise) {
        const query = { franchise: order.franchise, product: productId };
        if (variantSku) {
          query.variant_sku = variantSku;
        } else {
          query.$or = [{ variant_sku: null }, { variant_sku: { $exists: false } }];
        }
        await FranchiseInventory.updateOne(
          query,
          { $inc: { reserved_quantity: -qty } }
        );
      }
    }
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

    // Commit reserved inventory atomically (outlet or central based on item reservation)
    try {
      await this.commitOrderStock(order);
    } catch (stockErr) {
      console.error("Failed to commit order stock:", stockErr.message);
    }

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

    // Track coupon usage if coupon was applied
    if (order.coupon) {
      try {
        await CouponService.applyCouponUsage({
          couponId: order.coupon,
          userId: order.user,
          orderId: order._id,
          discountAmount: Number(order.couponDiscountAmount || 0),
          orderTotal: Number(order.totalAmount || 0),
        });
      } catch (couponUsageErr) {
        console.warn("Failed to record coupon usage in confirmOrderPayment:", couponUsageErr.message);
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

    // Release reserved inventory atomically (outlet or central based on item reservation)
    try {
      await this.releaseOrderStock(order);
    } catch (stockErr) {
      console.error("Failed to release order stock on cancellation:", stockErr.message);
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

    // 5. Commit reserved inventory deduction and record sales logs
    try {
      await FranchiseInventoryService.commitReservedStock(
        updatedOrder.franchise,
        updatedOrder.items
      );

      // Create Sales Log entry in OutletStockLog for each picked up item
      const OutletStockLog = require("../../models/outletStockLogModel");
      const FranchiseInventory = require("../../models/franchiseInventoryModel");
      for (const item of updatedOrder.items) {
        const prodId = item.product?._id || item.product || item.productId;
        const vSku = item.variant_sku || null;
        const itemSku = item.sku || vSku || "";
        const qty = Number(item.quantity || 1);

        const currentInv = await FranchiseInventory.findOne({
          franchise: updatedOrder.franchise,
          product: prodId,
          ...(vSku ? { variant_sku: vSku } : {}),
        });

        const qtyAfter = currentInv ? Number(currentInv.quantity_on_hand || 0) : 0;
        const qtyBefore = qtyAfter + qty;

        await OutletStockLog.create({
          franchise: updatedOrder.franchise,
          product: prodId,
          variant_sku: vSku,
          sku: itemSku,
          quantity: qty,
          type: "online_sale",
          quantity_before: qtyBefore,
          quantity_after: qtyAfter,
          reason: `Online order #${updatedOrder.orderNumber} picked up via OTP`,
          order: updatedOrder._id,
          order_number: updatedOrder.orderNumber,
          customer_name:
            updatedOrder.guestInfo?.name ||
            updatedOrder.shippingAddress?.fullName ||
            updatedOrder.user?.name ||
            "Online Customer",
          recorded_by: staffAdmin._id,
          recorded_by_name: staffAdmin.name || "Outlet Staff",
          recorded_by_role: staffAdmin.role || "franchise_owner",
        });
      }
    } catch (invErr) {
      console.error("Failed to commit reserved stock or create sales log on pickup:", invErr.message);
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
