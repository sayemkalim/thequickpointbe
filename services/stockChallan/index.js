const mongoose = require("mongoose");
const StockChallan = require("../../models/stockChallanModel");
const Franchise = require("../../models/franchiseModel");
const Product = require("../../models/productsModel");
const FranchiseInventory = require("../../models/franchiseInventoryModel");
const OutletStockLog = require("../../models/outletStockLogModel");

class StockChallanService {
  /**
   * Create Stock Challan and update Franchise Inventory
   */
  async createChallan({ franchiseId, items, notes = "", admin = null }) {
    if (!franchiseId) {
      throw new Error("Franchise is required.");
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Challan must contain at least one product item.");
    }

    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) {
      throw new Error("Franchise outlet not found.");
    }

    const processedItems = [];
    let totalQuantity = 0;

    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        throw new Error(`Invalid quantity for product ${item.product || item.productId}`);
      }

      const product = await Product.findById(item.product || item.productId);
      if (!product) {
        throw new Error(`Product not found: ${item.product || item.productId}`);
      }

      processedItems.push({
        product: product._id,
        name: product.name,
        sku: product.sku || item.sku || "",
        unit: product.unit || item.unit || "pcs",
        quantity: qty,
        receivedQuantity: qty,
      });

      totalQuantity += qty;
    }

    const challanNumber = await StockChallan.generateChallanNumber();

    const challan = new StockChallan({
      challanNumber,
      franchise: franchise._id,
      items: processedItems,
      totalQuantity,
      dispatchDate: new Date(),
      status: "dispatched",
      notes: notes || "",
      createdBy: admin?._id || null,
    });

    await challan.save();

    // Atomically restock FranchiseInventory for each product
    for (const item of processedItems) {
      let inv = await FranchiseInventory.findOne({
        franchise: franchise._id,
        product: item.product,
      });

      const previousStock = inv ? (inv.quantity_on_hand || 0) : 0;
      const newStock = previousStock + item.quantity;

      if (!inv) {
        inv = new FranchiseInventory({
          franchise: franchise._id,
          product: item.product,
          sku: item.sku || "",
          quantity_on_hand: item.quantity,
          total_restocked_quantity: item.quantity,
          available_quantity: item.quantity,
          reserved_quantity: 0,
          total_sold_quantity: 0,
          online_sold_quantity: 0,
          manual_sold_quantity: 0,
          last_restocked_at: new Date(),
        });
      } else {
        inv.quantity_on_hand = newStock;
        inv.total_restocked_quantity = (inv.total_restocked_quantity || 0) + item.quantity;
        inv.available_quantity = Math.max(0, inv.quantity_on_hand - (inv.reserved_quantity || 0));
        inv.last_restocked_at = new Date();
      }

      await inv.save();

      // Log stock movement
      try {
        await OutletStockLog.create({
          franchise: franchise._id,
          product: item.product,
          log_type: "restock",
          quantity_change: item.quantity,
          previous_quantity: previousStock,
          new_quantity: newStock,
          reference_id: challan._id,
          notes: `Stock Challan #${challan.challanNumber}`,
          performed_by: admin?._id || null,
        });
      } catch (logErr) {
        console.error("Stock log error:", logErr.message);
      }
    }

    return challan;
  }

  /**
   * List Stock Challans with filters
   */
  async getChallans({ franchiseId, status, startDate, endDate, search, page = 1, limit = 50 }) {
    const match = {};

    if (franchiseId && franchiseId !== "all") {
      match.franchise = franchiseId;
    }
    if (status && status !== "all") {
      match.status = status;
    }
    if (startDate || endDate) {
      match.dispatchDate = {};
      if (startDate) match.dispatchDate.$gte = new Date(startDate);
      if (endDate) {
        const eDate = new Date(endDate);
        eDate.setHours(23, 59, 59, 999);
        match.dispatchDate.$lte = eDate;
      }
    }
    if (search) {
      match.challanNumber = new RegExp(search.trim(), "i");
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [challans, totalCount] = await Promise.all([
      StockChallan.find(match)
        .populate("franchise", "name code outletCode phone address")
        .populate("createdBy", "name email")
        .sort({ dispatchDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      StockChallan.countDocuments(match),
    ]);

    return {
      challans,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(totalCount / Number(limit)),
      },
    };
  }

  /**
   * Get single Challan details
   */
  async getChallanDetails(id) {
    const challan = await StockChallan.findById(id)
      .populate("franchise", "name code outletCode phone address")
      .populate("items.product", "name sku price unit image images")
      .populate("createdBy", "name email")
      .lean();

    if (!challan) {
      throw new Error("Stock challan not found.");
    }
    return challan;
  }

  /**
   * Cancel Challan and revert stock
   */
  async cancelChallan({ challanId, reason = "", admin = null }) {
    const challan = await StockChallan.findById(challanId);
    if (!challan) {
      throw new Error("Stock challan not found.");
    }
    if (challan.status === "cancelled") {
      throw new Error("Challan is already cancelled.");
    }

    // Revert stock from inventory
    for (const item of challan.items) {
      const inv = await FranchiseInventory.findOne({
        franchise: challan.franchise,
        product: item.product,
      });

      if (inv) {
        const prev = inv.quantity_on_hand || 0;
        inv.quantity_on_hand = Math.max(0, prev - item.quantity);
        inv.total_restocked_quantity = Math.max(0, (inv.total_restocked_quantity || 0) - item.quantity);
        inv.available_quantity = Math.max(0, inv.quantity_on_hand - (inv.reserved_quantity || 0));
        await inv.save();

        try {
          await OutletStockLog.create({
            franchise: challan.franchise,
            product: item.product,
            log_type: "manual_adjustment",
            quantity_change: -item.quantity,
            previous_quantity: prev,
            new_quantity: inv.quantity_on_hand,
            reference_id: challan._id,
            notes: `Cancelled Challan #${challan.challanNumber}: ${reason || "Admin cancellation"}`,
            performed_by: admin?._id || null,
          });
        } catch (logErr) {
          console.error("Cancel stock log error:", logErr.message);
        }
      }
    }

    challan.status = "cancelled";
    challan.notes = [challan.notes, `Cancelled: ${reason}`].filter(Boolean).join(" | ");
    await challan.save();

    return challan;
  }

  /**
   * Create Stock Challan record for an already completed restock (avoids double incrementing inventory)
   */
  async createChallanRecordOnly({ franchiseId, items, notes = "", admin = null }) {
    if (!franchiseId) {
      throw new Error("Franchise is required.");
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Challan must contain at least one product item.");
    }

    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) {
      throw new Error("Franchise outlet not found.");
    }

    const processedItems = [];
    let totalQuantity = 0;

    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      if (isNaN(qty) || qty <= 0) continue;

      const product = await Product.findById(item.product || item.productId);
      if (!product) continue;

      processedItems.push({
        product: product._id,
        name: product.name,
        sku: product.sku || item.sku || "",
        unit: product.unit || item.unit || "pcs",
        quantity: qty,
        receivedQuantity: qty,
      });

      totalQuantity += qty;
    }

    if (processedItems.length === 0) {
      throw new Error("No valid items to include in challan.");
    }

    const challanNumber = await StockChallan.generateChallanNumber();

    const challan = new StockChallan({
      challanNumber,
      franchise: franchise._id,
      items: processedItems,
      totalQuantity,
      dispatchDate: new Date(),
      status: "dispatched",
      notes: notes || "Auto-generated upon restock dispatch",
      createdBy: admin?._id || null,
    });

    await challan.save();
    return challan;
  }
}

module.exports = new StockChallanService();
