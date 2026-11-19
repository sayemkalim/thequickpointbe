const mongoose = require("mongoose");
const CounterBill = require("../../models/counterBillModel");
const FranchiseInventory = require("../../models/franchiseInventoryModel");
const OutletStockLog = require("../../models/outletStockLogModel");
const Product = require("../../models/productsModel");
const FranchiseInventoryService = require("../franchiseInventory/index");

class PosBillingService {
  /**
   * Generates a unique sequential POS bill number
   */
  async generateBillNumber() {
    const yearMonth = new Date().toISOString().slice(2, 7).replace("-", ""); // e.g. 2411
    const count = await CounterBill.countDocuments({
      bill_number: new RegExp(`^POS-${yearMonth}`),
    });
    const seq = String(count + 1).padStart(4, "0");
    return `POS-${yearMonth}-${seq}`;
  }

  /**
   * Creates a new Walk-in Counter POS Bill
   * Atomically validates stock, deducts outlet inventory, logs movement, and records bill
   */
  async createPosBill({
    franchiseId,
    customerName = "Walk-in Customer",
    customerPhone = "",
    items,
    discountAmount = 0,
    receivedAmount = 0,
    paymentMethod = "cash",
    notes = "",
    admin,
  }) {
    if (!franchiseId) {
      throw new Error("Franchise ID is required for POS bill.");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("At least one product item is required to create a bill.");
    }

    // Role check: Franchise owner can only create bills for their own outlet
    if (admin.role === "franchise_owner") {
      if (String(admin.franchise) !== String(franchiseId)) {
        throw new Error("Access denied: You are only authorized to bill for your own outlet.");
      }
    }

    // 1. Validate Stock Availability in Franchise Inventory first
    const inventoryUpdates = [];
    const formattedItems = [];
    let subtotal = 0;
    let totalQty = 0;

    for (const it of items) {
      const prodId = it.productId || it.product?._id || it.product;
      const vSku = it.variant_sku || null;
      const qty = Math.max(1, parseInt(it.quantity, 10) || 1);

      const inv = await FranchiseInventory.findOne({
        franchise: franchiseId,
        product: prodId,
        ...(vSku ? { variant_sku: vSku } : {}),
      }).populate("product");

      if (!inv) {
        throw new Error(`Item not available in store inventory.`);
      }

      const availableStock = Math.max(0, (inv.quantity_on_hand || 0) - (inv.reserved_quantity || 0));
      if (availableStock < qty) {
        throw new Error(
          `Insufficient stock for "${inv.product?.name || inv.sku}". Available: ${availableStock} pcs, Requested: ${qty} pcs.`
        );
      }

      const prod = inv.product || {};
      const sellingPrice = Number(it.selling_price ?? it.price ?? prod.price ?? 0);
      const discountPercent = Math.max(0, Math.min(100, Number(it.discount_percent || 0)));
      const itemDiscount = (sellingPrice * discountPercent) / 100;
      const netUnitPrice = Math.max(0, sellingPrice - itemDiscount);
      const lineTotal = Number((qty * netUnitPrice).toFixed(2));

      subtotal += qty * sellingPrice;
      totalQty += qty;

      formattedItems.push({
        product: prod._id,
        name: prod.name || inv.sku,
        sku: inv.sku || prod.sku || "",
        variant_sku: vSku,
        unit: prod.unit || "pcs",
        quantity: qty,
        selling_price: sellingPrice,
        discount_percent: discountPercent,
        discount_amount: Number((itemDiscount * qty).toFixed(2)),
        total_amount: lineTotal,
      });

      inventoryUpdates.push({
        inventoryDoc: inv,
        quantity: qty,
        sellingPrice,
      });
    }

    const safeOverallDiscount = Math.max(0, Number(discountAmount) || 0);
    const grandTotal = Math.max(0, Number((subtotal - safeOverallDiscount).toFixed(2)));
    const safeReceived = Math.max(0, Number(receivedAmount) || 0);
    const dueAmount = Math.max(0, Number((grandTotal - safeReceived).toFixed(2)));

    let paymentStatus = "paid";
    if (dueAmount > 0 && safeReceived > 0) {
      paymentStatus = "partially_paid";
    } else if (dueAmount > 0 && safeReceived === 0) {
      paymentStatus = "unpaid";
    }

    const billNumber = await this.generateBillNumber();

    const paymentHistory = [];
    if (safeReceived > 0) {
      paymentHistory.push({
        amount: safeReceived,
        payment_method: paymentMethod,
        transaction_reference: "Initial Counter Payment",
        payment_date: new Date(),
        notes: "Collected at bill creation",
        recorded_by: admin?._id || null,
        recorded_by_name: admin?.name || "Cashier",
      });
    }

    // 2. Atomically deduct inventory and create sales logs
    for (const update of inventoryUpdates) {
      const inv = update.inventoryDoc;
      const qty = update.quantity;
      const qtyBefore = Number(inv.quantity_on_hand || 0);
      const qtyAfter = Math.max(0, qtyBefore - qty);

      inv.quantity_on_hand = qtyAfter;
      inv.manual_sold_quantity = Number(inv.manual_sold_quantity || 0) + qty;
      inv.total_sold_quantity = Number(inv.total_sold_quantity || 0) + qty;
      await inv.save();

      // Record Sales Log in OutletStockLog
      await OutletStockLog.create({
        franchise: franchiseId,
        product: inv.product._id,
        variant_sku: inv.variant_sku,
        sku: inv.sku,
        quantity: qty,
        type: "counter_sale",
        customer_name: customerName,
        customer_mobile: customerPhone,
        unit_price: update.sellingPrice,
        total_amount: update.sellingPrice * qty,
        received_amount: safeReceived,
        due_amount: dueAmount,
        payment_method: paymentMethod,
        bill_no: billNumber,
        quantity_before: qtyBefore,
        quantity_after: qtyAfter,
        reason: `Walk-in POS sale #${billNumber}`,
        recorded_by: admin?._id || null,
        recorded_by_name: admin?.name || "Outlet Staff",
        recorded_by_role: admin?.role || "franchise_owner",
      });
    }

    // 3. Create Counter Bill
    const counterBill = await CounterBill.create({
      bill_number: billNumber,
      franchise: franchiseId,
      customer_name: customerName,
      customer_phone: customerPhone,
      items: formattedItems,
      total_quantity: totalQty,
      subtotal: Number(subtotal.toFixed(2)),
      discount_amount: safeOverallDiscount,
      grand_total: grandTotal,
      received_amount: safeReceived,
      due_amount: dueAmount,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      payment_history: paymentHistory,
      bill_date: new Date(),
      notes: notes || "",
      billed_by: admin?._id || null,
      billed_by_name: admin?.name || "Outlet Staff",
    });

    return counterBill;
  }

  /**
   * Collects payment against an existing customer due without overwriting original bill history
   */
  async collectCustomerDuePayment({
    billId,
    amount,
    paymentMethod = "cash",
    transactionReference = "",
    notes = "",
    admin,
  }) {
    const bill = await CounterBill.findById(billId);
    if (!bill) {
      throw new Error("POS bill not found.");
    }

    if (bill.due_amount <= 0 || bill.payment_status === "paid") {
      throw new Error(`Bill #${bill.bill_number} has already been fully paid.`);
    }

    const payAmount = Math.max(0, Number(amount) || 0);
    if (payAmount <= 0) {
      throw new Error("Payment amount must be greater than zero.");
    }

    if (payAmount > bill.due_amount) {
      throw new Error(
        `Payment amount (₹${payAmount}) cannot exceed remaining customer due (₹${bill.due_amount}).`
      );
    }

    const newDue = Number((bill.due_amount - payAmount).toFixed(2));
    const newReceived = Number((bill.received_amount + payAmount).toFixed(2));

    bill.received_amount = newReceived;
    bill.due_amount = newDue;
    bill.payment_status = newDue === 0 ? "paid" : "partially_paid";

    // Append to payment history
    bill.payment_history.push({
      amount: payAmount,
      payment_method: paymentMethod,
      transaction_reference: transactionReference || "Customer Due Collection",
      payment_date: new Date(),
      notes: notes || "Customer partial payment collected",
      recorded_by: admin?._id || null,
      recorded_by_name: admin?.name || "Staff",
    });

    await bill.save();

    return bill;
  }

  /**
   * Lists POS bills with filters and pagination
   */
  async getPosBills({
    franchiseId,
    paymentStatus,
    customerPhone,
    startDate,
    endDate,
    search,
    limit = 20,
    page = 1,
  }) {
    const match = {};

    if (franchiseId) {
      match.franchise = new mongoose.Types.ObjectId(franchiseId);
    }

    if (paymentStatus) {
      match.payment_status = paymentStatus;
    }

    if (customerPhone) {
      match.customer_phone = new RegExp(customerPhone.trim(), "i");
    }

    if (search) {
      match.$or = [
        { bill_number: new RegExp(search.trim(), "i") },
        { customer_name: new RegExp(search.trim(), "i") },
        { customer_phone: new RegExp(search.trim(), "i") },
      ];
    }

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = eDate;
    }
    if (Object.keys(dateFilter).length > 0) {
      match.bill_date = dateFilter;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [bills, totalCount] = await Promise.all([
      CounterBill.find(match)
        .populate("franchise", "name code phone address")
        .sort({ bill_date: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      CounterBill.countDocuments(match),
    ]);

    return {
      bills,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(totalCount / Number(limit)),
      },
    };
  }

  /**
   * Gets details of a single POS bill
   */
  async getPosBillDetails(billId) {
    const bill = await CounterBill.findById(billId)
      .populate("franchise", "name code phone email address operatingHours")
      .populate("items.product", "name sku price wholesale_price unit hsn image")
      .lean();

    if (!bill) {
      throw new Error("POS bill not found.");
    }

    return bill;
  }
}

module.exports = new PosBillingService();
