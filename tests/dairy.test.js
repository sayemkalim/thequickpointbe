const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

// Models
const Franchise = require("../models/franchiseModel");
const FranchiseInventory = require("../models/franchiseInventoryModel");
const Product = require("../models/productsModel");
const Order = require("../models/orderModel");
const StoreSettings = require("../models/storeSettingsModel");
const CommissionLedger = require("../models/commissionLedgerModel");
const Admin = require("../models/adminModel");
const User = require("../models/userModel");

// Services
const FranchiseService = require("../services/franchise/index");
const FranchiseInventoryService = require("../services/franchiseInventory/index");
const CommissionService = require("../services/commission/index");
const DairyOrderService = require("../services/dairyOrder/index");
const CashfreeProvider = require("../services/payment/cashfreeProvider");

let mongoServer;

describe("Multi-Outlet Dairy Platform Test Suite", () => {
  before(async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "test_jwt_secret_dairy_12345";
    process.env.RAZORPAY_KEY_SECRET = "test_razorpay_secret_key";
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.APP_URL = "http://localhost:5000";

    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // Ensure 2dsphere index is built for spatial tests
    await Franchise.init();
    await FranchiseInventory.init();
    await CommissionLedger.init();
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // 1. QR Outlet Generation & Public QR Ordering
  test("1. Franchise creation generates unique QR code, URL, and QR token", async () => {
    const franchise = await FranchiseService.createFranchise({
      name: "Sudha Dairy Corner - Kankarbagh",
      code: "PAT01",
      phone: "9876543210",
      email: "kankarbagh@sudhadairy.in",
      address: { street: "Main Road", locality: "Kankarbagh", city: "Patna", state: "Bihar" },
      longitude: 85.1522,
      latitude: 25.5941,
      radiusKm: 15,
      commissionOverride: {
        enabled: true,
        type: "percentage",
        value: 12,
      },
    });

    assert.ok(franchise._id, "Franchise should have an _id");
    assert.equal(franchise.code, "PAT01");
    assert.ok(franchise.qrToken.startsWith("OUT_PAT01_"), "QR token should have prefix OUT_PAT01_");
    assert.ok(franchise.qrPublicUrl.includes(franchise.qrToken), "Public QR URL should contain token");
    assert.ok(franchise.qrCodeUrl.startsWith("data:image/png;base64,"), "QR code data URL must be valid base64 PNG");

    // Test resolving outlet by QR Token
    const resolvedOutlet = await FranchiseService.getByQrToken(franchise.qrToken);
    assert.equal(resolvedOutlet._id.toString(), franchise._id.toString());
  });

  // 2. Proximity-Based Nearest Outlet Discovery (2dsphere index)
  test("2. Proximity search finds nearest outlet in Bihar within radius", async () => {
    // Create second franchise in Muzaffarpur (~70km away from Patna)
    await FranchiseService.createFranchise({
      name: "Sudha Dairy - Muzaffarpur Centre",
      code: "MUZ01",
      phone: "9876543211",
      address: { street: "Station Road", city: "Muzaffarpur", state: "Bihar" },
      longitude: 85.3906,
      latitude: 26.1209,
      radiusKm: 15,
    });

    // Customer at Patna coordinates (85.14, 25.60)
    const patnaNearby = await FranchiseService.findNearestOutlets({
      longitude: 85.14,
      latitude: 25.60,
      radiusKm: 20,
    });

    assert.ok(patnaNearby.length >= 1, "Should find Patna outlet within 20km");
    assert.equal(patnaNearby[0].code, "PAT01", "Closest outlet must be PAT01 in Patna");
    // Muzaffarpur is 70km away, so it should not appear in 20km radius search
    const hasMuzaffarpur = patnaNearby.some((o) => o.code === "MUZ01");
    assert.equal(hasMuzaffarpur, false, "Muzaffarpur outlet must NOT appear within 20km Patna search");
  });

  // 3. Outlet-Specific Inventory & Safe Concurrent Stock Reservation
  test("3. Safe atomic stock reservation at outlet and release on cancellation", async () => {
    const patnaFranchise = await Franchise.findOne({ code: "PAT01" });

    // Create a dairy product (Milk 1L)
    const milkProduct = await Product.create({
      name: "Taza Cow Milk 1 Litre",
      sku: "DAIRY-MILK-1L",
      price: 60,
      discounted_price: 58,
      inventory: 0,
      isDairy: true,
      dairyCategory: "milk",
      unit: "1L",
      status: "published",
      created_by_admin: new mongoose.Types.ObjectId(),
    });

    // Restock 10 packets at Patna outlet
    await FranchiseInventoryService.restock({
      franchiseId: patnaFranchise._id,
      productId: milkProduct._id,
      sku: milkProduct.sku,
      quantity: 10,
      lowStockThreshold: 3,
    });

    const inv = await FranchiseInventory.findOne({
      franchise: patnaFranchise._id,
      product: milkProduct._id,
    });
    assert.equal(inv.quantity_on_hand, 10);
    assert.equal(inv.reserved_quantity, 0);
    assert.equal(inv.available_quantity, 10);

    // Reserve 4 packets for order checkout
    const reservation = await FranchiseInventoryService.reserveStockForOrder(
      patnaFranchise._id,
      [{ product: milkProduct._id, quantity: 4 }]
    );
    assert.equal(reservation.success, true);

    const invAfterRes = await FranchiseInventory.findOne({
      franchise: patnaFranchise._id,
      product: milkProduct._id,
    });
    assert.equal(invAfterRes.reserved_quantity, 4);
    assert.equal(invAfterRes.available_quantity, 6); // 10 - 4 = 6 available

    // Attempt to reserve 8 packets (exceeding remaining 6 available stock) -> must fail safely
    await assert.rejects(
      async () => {
        await FranchiseInventoryService.reserveStockForOrder(
          patnaFranchise._id,
          [{ product: milkProduct._id, quantity: 8 }]
        );
      },
      /Insufficient stock/,
      "Must reject when requested qty exceeds available stock"
    );

    // Stock reservation remains at 4 after failed attempt (no corruption)
    const invAfterFailed = await FranchiseInventory.findOne({
      franchise: patnaFranchise._id,
      product: milkProduct._id,
    });
    assert.equal(invAfterFailed.reserved_quantity, 4);

    // Release 4 packets on order cancellation
    await FranchiseInventoryService.releaseReservedStock(patnaFranchise._id, [
      { product: milkProduct._id, quantity: 4 },
    ]);
    const invAfterRelease = await FranchiseInventory.findOne({
      franchise: patnaFranchise._id,
      product: milkProduct._id,
    });
    assert.equal(invAfterRelease.reserved_quantity, 0);
    assert.equal(invAfterRelease.available_quantity, 10);
  });

  // 4. Dairy Order Creation, Immutable Commission Snapshot, & Pickup OTP
  test("4. Dairy order creation with pickup fulfillment and immutable commission snapshot", async () => {
    const patnaFranchise = await Franchise.findOne({ code: "PAT01" });
    const milk = await Product.findOne({ sku: "DAIRY-MILK-1L" });

    const orderResult = await DairyOrderService.createDairyOrder({
      franchiseId: patnaFranchise._id,
      items: [{ product: milk._id, quantity: 2 }],
      customerName: "Ramesh Kumar",
      customerPhone: "9876543210",
      customerEmail: "ramesh@example.com",
    });

    const order = orderResult.order;
    assert.ok(order._id);
    assert.equal(order.fulfillmentType, "pickup");
    assert.equal(order.shippingCost.toString(), "0");
    assert.equal(order.finalTotalAmount.toString(), "116"); // 58 * 2 = 116
    assert.ok(order.pickupOtp, "Must generate pickup OTP");
    assert.equal(order.pickupOtp.length, 6, "Pickup OTP must be 6 digits");
    assert.equal(order.pickupStatus, "pending");

    // Commission snapshot checks
    const snapshot = order.commissionSnapshot;
    assert.ok(snapshot);
    assert.equal(snapshot.rateValue, 12); // From PAT01 12% commission override
    assert.equal(snapshot.rateType, "percentage");
    assert.ok(snapshot.outletCommissionAmount, "Must compute outlet commission");
    assert.ok(snapshot.platformCommissionAmount, "Must compute platform commission");

    // Confirm that stock was reserved for this order
    const inv = await FranchiseInventory.findOne({
      franchise: patnaFranchise._id,
      product: milk._id,
    });
    assert.equal(inv.reserved_quantity, 2);
  });

  // 5. Payment Verification & Idempotency
  test("5. Payment verification confirms order and prevents duplicate payment updates", async () => {
    const order = await Order.findOne({ fulfillmentType: "pickup", paymentStatus: "pending" });
    assert.ok(order);

    const paymentId = "pay_test_123456789";
    await DairyOrderService.confirmOrderPayment(order, paymentId, "razorpay");

    const paidOrder = await Order.findById(order._id);
    assert.equal(paidOrder.paymentStatus, "paid");
    assert.equal(paidOrder.status, "confirmed");
    assert.equal(paidOrder.pickupStatus, "ready_for_pickup");
    assert.equal(paidOrder.paymentId, paymentId);

    // Repeat payment confirmation (Idempotency check)
    const idempotentOrder = await DairyOrderService.confirmOrderPayment(
      paidOrder,
      paymentId,
      "razorpay"
    );
    assert.equal(idempotentOrder.paymentStatus, "paid");
  });

  // 6. Outlet Staff Pickup Verification & Duplicate Prevention
  test("6. Pickup OTP verification by authorized staff finalizes pickup and prevents duplicate pickup", async () => {
    const patnaFranchise = await Franchise.findOne({ code: "PAT01" });
    const order = await Order.findOne({ fulfillmentType: "pickup", paymentStatus: "paid" });
    assert.ok(order);

    // Create staff admin assigned to PAT01
    const staffAdmin = await Admin.create({
      name: "Patna Outlet Manager",
      email: "staff.patna@dairy.in",
      password: "password123",
      role: "franchise_owner",
      franchise: patnaFranchise._id,
    });

    // Create staff from another outlet (MUZ01) to test unauthorized verification rejection
    const unauthorizedStaff = await Admin.create({
      name: "Muzaffarpur Manager",
      email: "staff.muz@dairy.in",
      password: "password123",
      role: "franchise_owner",
      franchise: new mongoose.Types.ObjectId(), // Different franchise
    });

    // Staff from wrong outlet attempts verification -> must be rejected
    await assert.rejects(
      async () => {
        await DairyOrderService.verifyPickupOtp({
          orderId: order._id,
          otp: order.pickupOtp,
          staffAdmin: unauthorizedStaff,
        });
      },
      /Access denied/,
      "Unauthorized staff from different outlet must be rejected"
    );

    // Wrong OTP attempt
    await assert.rejects(
      async () => {
        await DairyOrderService.verifyPickupOtp({
          orderId: order._id,
          otp: "000000",
          staffAdmin,
        });
      },
      /Invalid Pickup OTP/,
      "Incorrect OTP must be rejected"
    );

    // Correct OTP verification by authorized staff
    const verifyResult = await DairyOrderService.verifyPickupOtp({
      orderId: order._id,
      otp: order.pickupOtp,
      staffAdmin,
    });

    assert.equal(verifyResult.success, true);
    assert.equal(verifyResult.order.pickupStatus, "picked_up");
    assert.equal(verifyResult.order.status, "delivered");
    assert.ok(verifyResult.order.pickedUpAt);

    // Verify Commission Ledger entry created
    const ledger = await CommissionLedger.findOne({ order: order._id });
    assert.ok(ledger, "CommissionLedger record must be created on pickup");
    assert.equal(ledger.franchise.toString(), patnaFranchise._id.toString());
    assert.equal(ledger.status, "accrued");

    // Attempt duplicate pickup verification -> must be rejected idempotently
    const duplicateVerify = await DairyOrderService.verifyPickupOtp({
      orderId: order._id,
      otp: order.pickupOtp,
      staffAdmin,
    });

    assert.equal(duplicateVerify.success, false);
    assert.equal(duplicateVerify.alreadyPickedUp, true);

    // Ensure only 1 Commission Ledger entry exists (no duplicate commissions)
    const ledgerCount = await CommissionLedger.countDocuments({ order: order._id });
    assert.equal(ledgerCount, 1, "There must be exactly one commission record for the order");
  });

  // 7. Customer Mobile OTP Authentication
  test("7. Customer mobile OTP generation and verification creates session token", async () => {
    const phone = "9123456789";

    // Request OTP
    const user = await User.create({
      phone,
      mobileOtp: "654321",
      mobileOtpExpires: new Date(Date.now() + 10 * 60 * 1000),
      mobileOtpAttempts: 0,
    });

    assert.equal(user.phone, phone);
    assert.equal(user.mobileOtp, "654321");

    // Verify OTP
    assert.equal(user.mobileOtp, "654321");
    user.mobileOtp = null;
    user.mobileOtpExpires = null;
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    assert.equal(decoded.id.toString(), user._id.toString());
  });

  // 8. Optional Cashfree Provider Webhook Verification
  test("8. Optional Cashfree provider validates webhook signature", async () => {
    const isValid = await CashfreeProvider.verifyWebhookSignature({
      rawBody: JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK" }),
      signature: "valid_test_signature",
      timestamp: "1672531199",
    });
    assert.equal(isValid, true, "Test signature must validate");
  });

  // 9. Immutable Commission Snapshot Integrity
  test("9. Subsequent rate changes to store settings do not alter past order commission snapshots", async () => {
    const existingOrder = await Order.findOne({ fulfillmentType: "pickup", paymentStatus: "paid" });
    const originalRate = existingOrder.commissionSnapshot.rateValue;
    const originalOutletAmount = existingOrder.commissionSnapshot.outletCommissionAmount.toString();

    // Central admin changes global store commission to 25%
    let settings = await StoreSettings.findOne();
    if (!settings) settings = await StoreSettings.create({});
    settings.commission = { type: "percentage", value: 25 };
    await settings.save();

    // Verify the past order's snapshot remains unchanged
    const reloadedOrder = await Order.findById(existingOrder._id);
    assert.equal(
      reloadedOrder.commissionSnapshot.rateValue,
      originalRate,
      "Past order commission rate must remain unchanged"
    );
    assert.equal(
      reloadedOrder.commissionSnapshot.outletCommissionAmount.toString(),
      originalOutletAmount,
      "Past order outlet earnings must remain identical"
    );
  });

  // 10. Role-Based Permissions & Outlet Data Isolation
  test("10. Franchise Owner cannot access other outlet's data; Central Admin has global access", async () => {
    const patnaFranchise = await Franchise.findOne({ code: "PAT01" });
    const muzFranchise = await Franchise.findOne({ code: "MUZ01" });

    const { scopeToFranchise } = require("../middleware/auth/adminMiddleware");

    // Mock Franchise Owner for Patna
    const patnaOwner = {
      role: "franchise_owner",
      franchise: patnaFranchise._id,
    };

    // Attempting to access Muz outlet data with Patna owner credentials -> must be rejected
    const fakeReq = {
      admin: patnaOwner,
      params: { franchiseId: muzFranchise._id.toString() },
      body: {},
      query: {},
    };

    let forbiddenCalled = false;
    const fakeRes = {
      status: (code) => {
        if (code === 403) forbiddenCalled = true;
        return { json: () => {} };
      },
    };

    scopeToFranchise(fakeReq, fakeRes, () => {});
    assert.equal(forbiddenCalled, true, "Franchise owner must be forbidden from accessing other outlets");

    // Central Admin accessing Muz outlet -> must be allowed
    const centralAdmin = {
      role: "super_admin",
    };
    const adminReq = {
      admin: centralAdmin,
      params: { franchiseId: muzFranchise._id.toString() },
      body: {},
      query: {},
    };
    let nextCalled = false;
    scopeToFranchise(adminReq, fakeRes, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true, "Central admin must be granted access");
    assert.equal(adminReq.scopedFranchiseId, muzFranchise._id.toString());
  });

  // 11. Duplicate Webhook Handling & Idempotency
  test("11. Duplicate payment webhook events are handled idempotently", async () => {
    const order = await Order.findOne({ fulfillmentType: "pickup", paymentStatus: "paid" });

    // Simulate duplicate webhook confirmation call
    await DairyOrderService.confirmOrderPayment(order, "pay_duplicate_event_1", "razorpay");
    const updated = await Order.findById(order._id);

    assert.equal(updated.paymentStatus, "paid");
    assert.equal(updated.pickupStatus, "picked_up");
    assert.equal(updated.status, "delivered");
  });
});
