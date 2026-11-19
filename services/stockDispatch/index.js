const mongoose = require("mongoose");
const StockDispatch = require("../../models/stockDispatchModel");
const Franchise = require("../../models/franchiseModel");
const Product = require("../../models/productsModel");
const FranchiseInventoryService = require("../franchiseInventory/index");
const FranchiseLedgerService = require("../franchiseLedger/index");
const StockMovement = require("../../models/stockMovementModel");

class StockDispatchService {
  /**
   * Generates a unique sequential stock dispatch invoice number
   */
  async generateInvoiceNumber() {
    const yearMonth = new Date().toISOString().slice(2, 7).replace("-", ""); // e.g. 2411
    const count = await StockDispatch.countDocuments({
      invoice_no: new RegExp(`^WD-${yearMonth}`),
    });
    const seq = String(count + 1).padStart(4, "0");
    return `WD-${yearMonth}-${seq}`;
  }

  /**
   * Creates and issues a new Wholesale Stock Dispatch Invoice
   */
  async createDispatchInvoice({
    franchiseId,
    items,
    discountAmount = 0,
    notes = "",
    status = "issued",
    admin,
  }) {
    if (!franchiseId) {
      throw new Error("Franchise is required for stock dispatch.");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("At least one product item is required for stock dispatch.");
    }

    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) {
      throw new Error("Franchise outlet not found.");
    }

    const formattedItems = [];
    let subtotal = 0;
    let totalDispatchedQty = 0;

    for (const item of items) {
      const prodId = item.productId || item.product?._id || item.product;
      const product = await Product.findById(prodId).lean();
      if (!product) {
        throw new Error(`Product not found: ${prodId}`);
      }

      const qty = Number(item.dispatched_quantity ?? item.quantity ?? 1);
      if (qty <= 0) {
        throw new Error(`Invalid dispatched quantity for product: ${product.name}`);
      }

      // Snapshot wholesale unit price
      const wholesalePrice = Number(
        item.wholesale_price ?? item.price ?? product.wholesale_price ?? product.price ?? 0
      );
      const totalAmount = Number((qty * wholesalePrice).toFixed(2));

      subtotal += totalAmount;
      totalDispatchedQty += qty;

      formattedItems.push({
        product: product._id,
        name: product.name,
        sku: item.sku || product.sku || "",
        variant_sku: item.variant_sku || null,
        unit: item.unit || product.unit || "pcs",
        hsn: item.hsn || product.hsn || "",
        dispatched_quantity: qty,
        received_quantity: 0,
        wholesale_price: wholesalePrice,
        total_amount: totalAmount,
        discrepancy_reason: "",
      });
    }

    const safeDiscount = Math.max(0, Number(discountAmount) || 0);
    const grandTotal = Math.max(0, Number((subtotal - safeDiscount).toFixed(2)));
    const invoiceNo = await this.generateInvoiceNumber();

    const dispatch = await StockDispatch.create({
      invoice_no: invoiceNo,
      franchise: franchiseId,
      status: status || "issued",
      items: formattedItems,
      total_dispatched_quantity: totalDispatchedQty,
      total_received_quantity: 0,
      subtotal: Number(subtotal.toFixed(2)),
      discount_amount: safeDiscount,
      grand_total: grandTotal,
      dispatched_date: new Date(),
      dispatched_by: admin?._id || null,
      dispatched_by_name: admin?.name || "Central Warehouse",
      notes: notes || "",
    });

    return dispatch;
  }

  /**
   * Confirms receipt of stock at franchise outlet with support for discrepancies
   * Atomically updates FranchiseInventory and posts wholesale payable Debit entry in Ledger
   */
  async confirmStockReceipt({
    dispatchId,
    receivedItems = [], // [{ productId, received_quantity, discrepancy_reason }]
    notes = "",
    admin,
  }) {
    const dispatch = await StockDispatch.findById(dispatchId);
    if (!dispatch) {
      throw new Error("Stock dispatch invoice not found.");
    }

    if (dispatch.status === "received") {
      throw new Error(`Dispatch invoice #${dispatch.invoice_no} has already been confirmed and received.`);
    }

    if (dispatch.status === "cancelled") {
      throw new Error(`Cannot confirm receipt for cancelled dispatch invoice #${dispatch.invoice_no}.`);
    }

    // Role check: Franchise owner can only confirm for their own outlet
    if (admin.role === "franchise_owner") {
      if (String(admin.franchise) !== String(dispatch.franchise)) {
        throw new Error("Access denied: You are only authorized to confirm stock for your own outlet.");
      }
    }

    let totalReceivedQty = 0;
    let hasDiscrepancy = false;

    // Process item receipt quantities
    for (const item of dispatch.items) {
      const pId = String(item.product);
      const reported = receivedItems.find(
        (r) => String(r.productId || r.product?._id || r.product) === pId
      );

      const rQty = reported !== undefined && reported.received_quantity !== undefined
        ? Math.max(0, Number(reported.received_quantity))
        : item.dispatched_quantity; // Default to full dispatch if not specified

      item.received_quantity = rQty;
      totalReceivedQty += rQty;

      if (reported?.discrepancy_reason) {
        item.discrepancy_reason = reported.discrepancy_reason;
      }

      if (rQty !== item.dispatched_quantity) {
        hasDiscrepancy = true;
      }
    }

    dispatch.total_received_quantity = totalReceivedQty;
    dispatch.status = hasDiscrepancy ? "partially_received" : "received";
    dispatch.received_date = new Date();
    dispatch.received_by = admin?._id || null;
    dispatch.received_by_name = admin?.name || "Franchise Staff";
    if (notes) dispatch.notes = `${dispatch.notes} | Recv Notes: ${notes}`.trim();

    // 1. Atomically restock FranchiseInventory for each received item
    for (const item of dispatch.items) {
      if (item.received_quantity > 0) {
        await FranchiseInventoryService.restock({
          franchiseId: dispatch.franchise,
          productId: item.product,
          variantSku: item.variant_sku,
          sku: item.sku,
          quantity: item.received_quantity,
          adminId: admin?._id,
        });

        // Record stock movement log
        try {
          await StockMovement.create({
            product: item.product,
            quantity: item.received_quantity,
            type: "in",
            reason: `Wholesale stock received via dispatch invoice #${dispatch.invoice_no}`,
            referenceType: "order",
            referenceId: dispatch._id,
            createdBy: admin?._id,
          });
        } catch (logErr) {
          console.error("Stock movement log error:", logErr.message);
        }
      }
    }

    // 2. Atomically post Debit entry to FranchiseAccountLedger (Khata Book)
    let ledgerEntry = null;
    try {
      ledgerEntry = await FranchiseLedgerService.recordStockInvoiceDebit(dispatch, admin);
    } catch (ledgerErr) {
      console.error("Franchise ledger debit posting error:", ledgerErr.message);
    }

    await dispatch.save();

    return {
      success: true,
      dispatch,
      ledgerEntry,
    };
  }

  /**
   * Cancels a stock dispatch invoice before receipt
   */
  async cancelDispatchInvoice({ dispatchId, reason = "", admin }) {
    const dispatch = await StockDispatch.findById(dispatchId);
    if (!dispatch) {
      throw new Error("Stock dispatch invoice not found.");
    }

    if (["received", "partially_received"].includes(dispatch.status)) {
      throw new Error("Cannot cancel an invoice that has already been confirmed as received.");
    }

    dispatch.status = "cancelled";
    dispatch.cancellation_reason = reason || "Cancelled by admin";
    await dispatch.save();

    return dispatch;
  }

  /**
   * Lists stock dispatch invoices with rich filtering and pagination
   */
  async getDispatchInvoices({
    franchiseId,
    status,
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

    if (status) {
      match.status = status;
    }

    if (search) {
      match.$or = [
        { invoice_no: new RegExp(search.trim(), "i") },
        { "items.name": new RegExp(search.trim(), "i") },
        { "items.sku": new RegExp(search.trim(), "i") },
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
      match.dispatched_date = dateFilter;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [dispatches, totalCount] = await Promise.all([
      StockDispatch.find(match)
        .populate("franchise", "name code phone address")
        .populate("dispatched_by", "name email role")
        .populate("received_by", "name email role")
        .sort({ dispatched_date: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      StockDispatch.countDocuments(match),
    ]);

    return {
      dispatches,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(totalCount / Number(limit)),
      },
    };
  }

  /**
   * Gets single dispatch invoice details
   */
  async getDispatchDetails(dispatchId) {
    const dispatch = await StockDispatch.findById(dispatchId)
      .populate("franchise", "name code phone email address operatingHours")
      .populate("items.product", "name sku price wholesale_price unit hsn image")
      .populate("dispatched_by", "name email")
      .populate("received_by", "name email")
      .populate("ledger_entry")
      .lean();

    if (!dispatch) {
      throw new Error("Stock dispatch invoice not found.");
    }

    return dispatch;
  }
}

module.exports = new StockDispatchService();

