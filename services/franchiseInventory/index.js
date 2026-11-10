const FranchiseInventory = require("../../models/franchiseInventoryModel");
const Product = require("../../models/productsModel");
const mongoose = require("mongoose");

class FranchiseInventoryService {
  /**
   * List inventory for a specific franchise outlet (or all outlets if franchiseId === "all")
   */
  async listByFranchise({ franchiseId, page = 1, per_page = 50, search = "", filter = "all" }) {
    const query = {};
    if (franchiseId && franchiseId !== "all") {
      query.franchise = franchiseId;
    }

    if (filter === "low_stock") {
      query.$expr = {
        $lte: [
          { $subtract: ["$quantity_on_hand", "$reserved_quantity"] },
          "$low_stock_threshold",
        ],
      };
    } else if (filter === "out_of_stock") {
      query.$expr = {
        $lte: [{ $subtract: ["$quantity_on_hand", "$reserved_quantity"] }, 0],
      };
    }

    const skip = (Math.max(1, page) - 1) * per_page;

    const [items, total] = await Promise.all([
      FranchiseInventory.find(query)
        .populate("franchise", "name outletCode address city phone")
        .populate("product", "name sku price discounted_price banner_image isDairy dairyCategory unit")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(per_page)
        .lean(),
      FranchiseInventory.countDocuments(query),
    ]);

    // Format metrics: who sold how many pcs, who has how many on hand, and how many are remaining
    const formatted = items.map((inv) => {
      const totalSoldQty = Number(inv.total_sold_quantity || 0);
      const offlineSoldQty = Number(inv.manual_sold_quantity || 0);
      const onlineSoldQty =
        inv.online_sold_quantity !== undefined && inv.online_sold_quantity !== null
          ? Number(inv.online_sold_quantity)
          : Math.max(0, totalSoldQty - offlineSoldQty);
      const effectiveTotalSold = Math.max(totalSoldQty, onlineSoldQty + offlineSoldQty);
      const onHandQty = Number(inv.quantity_on_hand || 0);
      const reservedQty = Number(inv.reserved_quantity || 0);
      const restockedQty =
        inv.total_restocked_quantity && inv.total_restocked_quantity > 0
          ? Number(inv.total_restocked_quantity)
          : onHandQty + effectiveTotalSold;
      const availableQty = Math.max(0, onHandQty - reservedQty);

      return {
        ...inv,
        total_restocked_quantity: restockedQty,
        total_sold_quantity: effectiveTotalSold,
        online_sold_quantity: onlineSoldQty,
        offline_sold_quantity: offlineSoldQty,
        manual_sold_quantity: offlineSoldQty,
        quantity_on_hand: onHandQty,
        reserved_quantity: reservedQty,
        available_quantity: availableQty,
        is_low_stock: availableQty <= (inv.low_stock_threshold || 10),
      };
    });

    // Summary stats for top cards
    const stats = {
      total_restocked: formatted.reduce((acc, i) => acc + (i.total_restocked_quantity || 0), 0),
      total_sold: formatted.reduce((acc, i) => acc + (i.total_sold_quantity || 0), 0),
      online_sold: formatted.reduce((acc, i) => acc + (i.online_sold_quantity || 0), 0),
      offline_sold: formatted.reduce((acc, i) => acc + (i.offline_sold_quantity || 0), 0),
      total_on_hand: formatted.reduce((acc, i) => acc + (i.quantity_on_hand || 0), 0),
      total_available: formatted.reduce((acc, i) => acc + (i.available_quantity || 0), 0),
      total_reserved: formatted.reduce((acc, i) => acc + (i.reserved_quantity || 0), 0),
    };

    return {
      items: formatted,
      stats,
      total,
      page: Number(page),
      per_page: Number(per_page),
      total_pages: Math.ceil(total / per_page),
    };
  }

  /**
   * Restock or set initial stock for an outlet's product.
   * STRICT GUARD: Outlets cannot receive more stock than what is available in Central Inventory.
   * Automatically deducts dispatched quantity from Central Warehouse.
   */
  async restock({ franchiseId, productId, variantSku = null, sku, quantity, lowStockThreshold = null, adminId = null }) {
    if (!franchiseId || !productId || quantity === undefined) {
      throw new Error("franchiseId, productId, and quantity are required.");
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new Error("Restock quantity must be a positive number.");
    }

    let resolvedSku = sku;
    if (!resolvedSku) {
      const product = await Product.findById(productId).lean();
      if (!product) throw new Error("Product not found");
      resolvedSku = variantSku || product.sku;
    }

    const InventoryService = require("../inventory/index.js");
    const Franchise = require("../../models/franchiseModel");
    const Inventory = require("../../models/inventoryModel");

    // 1. Strict Central Inventory check: cannot restock more than central warehouse has available
    let centralInv = await Inventory.findOne({
      product: productId,
      variant_sku: variantSku || null,
    });

    if (!centralInv) {
      // Ensure central record exists
      centralInv = await InventoryService.ensureInventoryRecord({
        productId,
        variantSku: variantSku || null,
        sku: resolvedSku,
        adminId,
      });
    }

    const centralOnHand = centralInv ? Number(centralInv.quantity_on_hand || 0) : 0;
    const centralReserved = centralInv ? Number(centralInv.reserved_quantity || 0) : 0;
    const centralAvailable = Math.max(0, centralOnHand - centralReserved);

    if (qty > centralAvailable) {
      throw new Error(
        `Cannot restock ${qty} units. Central Warehouse only has ${centralAvailable} units available.`
      );
    }

    // 2. Deduct from Central Warehouse with allowNegative: false
    const franchise = await Franchise.findById(franchiseId).select("name").lean();
    const franchiseName = franchise?.name || String(franchiseId);

    await InventoryService.adjustStock({
      productId,
      variantSku: variantSku || null,
      quantityChange: -qty,
      type: "outlet_dispatch",
      note: `Dispatched to outlet: ${franchiseName}`,
      adminId,
      referenceType: "outlet",
      referenceId: franchiseId,
      allowNegative: false,
    });

    // 3. Increment Outlet Inventory
    const query = {
      franchise: franchiseId,
      product: productId,
      variant_sku: variantSku || null,
    };

    const update = {
      $inc: {
        quantity_on_hand: qty,
        total_restocked_quantity: qty,
      },
      $set: {
        sku: resolvedSku,
        last_restocked_at: new Date(),
        updated_by_admin: adminId,
      },
    };

    if (lowStockThreshold !== null && lowStockThreshold !== undefined && lowStockThreshold !== "") {
      update.$set.low_stock_threshold = Number(lowStockThreshold);
    }

    const inventory = await FranchiseInventory.findOneAndUpdate(query, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    return inventory;
  }

  /**
   * Safely reserves stock atomically at checkout to prevent overselling under concurrent requests.
   * If any item is unavailable, rolls back already reserved items and throws an error.
   */
  async reserveStockForOrder(franchiseId, items) {
    const reservedItems = [];

    try {
      for (const item of items) {
        const productId = item.product?._id || item.product || item.productId;
        const variantSku = item.variant_sku || null;
        const requestedQty = Number(item.quantity || 1);

        const query = {
          franchise: franchiseId,
          product: productId,
          variant_sku: variantSku,
          $expr: {
            $gte: [
              { $subtract: ["$quantity_on_hand", "$reserved_quantity"] },
              requestedQty,
            ],
          },
        };

        const updated = await FranchiseInventory.findOneAndUpdate(
          query,
          { $inc: { reserved_quantity: requestedQty } },
          { new: true }
        );

        if (!updated) {
          // Fetch current stock to provide informative error
          const current = await FranchiseInventory.findOne({
            franchise: franchiseId,
            product: productId,
            variant_sku: variantSku,
          }).lean();

          const available = current
            ? Math.max(0, (current.quantity_on_hand || 0) - (current.reserved_quantity || 0))
            : 0;

          throw new Error(
            `Insufficient stock for item (ID: ${productId}). Requested: ${requestedQty}, Available: ${available}`
          );
        }

        reservedItems.push({
          productId,
          variantSku,
          quantity: requestedQty,
        });
      }

      return { success: true, reservedItems };
    } catch (error) {
      // Rollback any successfully reserved items
      for (const resItem of reservedItems) {
        await FranchiseInventory.updateOne(
          {
            franchise: franchiseId,
            product: resItem.productId,
            variant_sku: resItem.variantSku,
          },
          { $inc: { reserved_quantity: -resItem.quantity } }
        );
      }
      throw error;
    }
  }

  /**
   * Releases previously reserved stock back to available pool (e.g., payment cancelled or failed)
   */
  async releaseReservedStock(franchiseId, items) {
    for (const item of items) {
      const productId = item.product?._id || item.product || item.productId;
      const variantSku = item.variant_sku || null;
      const qty = Number(item.quantity || 1);

      await FranchiseInventory.updateOne(
        {
          franchise: franchiseId,
          product: productId,
          variant_sku: variantSku,
        },
        {
          $inc: { reserved_quantity: -qty },
        }
      );
    }
  }

  /**
   * Commits the reserved stock when order is fulfilled/picked up or confirmed paid
   * Deducts quantity_on_hand, decrements reserved_quantity, and increments total_sold_quantity
   */
  async commitReservedStock(franchiseId, items) {
    for (const item of items) {
      const productId = item.product?._id || item.product || item.productId;
      const variantSku = item.variant_sku || null;
      const qty = Number(item.quantity || 1);

      await FranchiseInventory.updateOne(
        {
          franchise: franchiseId,
          product: productId,
          variant_sku: variantSku,
        },
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

  /**
   * Manually reduce or record offline counter sales for an outlet inventory item.
   * Can be performed by Franchise Owner (for their own outlet) or Super Admin / Admin (for any outlet).
   */
  async reduceStock({
    franchiseId,
    productId,
    variantSku = null,
    sku = null,
    quantity,
    type = "counter_sale",
    reason = "",
    adminId = null,
    adminName = "",
    adminRole = "",
  }) {
    if (!franchiseId || !productId || quantity === undefined) {
      throw new Error("franchiseId, productId, and quantity are required.");
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new Error("Quantity to deduct must be a positive number.");
    }

    if (type === "adjustment" && adminRole === "franchise_owner") {
      throw new Error(
        "Franchise owners cannot perform Stock Less / Audit Adjustment. Only Super Admin can adjust stock."
      );
    }

    const query = {
      franchise: franchiseId,
      product: productId,
    };
    if (variantSku) {
      query.variant_sku = variantSku;
    }

    const inventory = await FranchiseInventory.findOne(query);
    if (!inventory) {
      throw new Error("No inventory record found for this product in the selected outlet.");
    }

    const onHand = Number(inventory.quantity_on_hand || 0);
    const reserved = Number(inventory.reserved_quantity || 0);
    const available = Math.max(0, onHand - reserved);

    if (qty > available) {
      throw new Error(
        `Cannot deduct ${qty} units. Only ${available} units are available on shelf (${reserved} units reserved for active customer pickup orders).`
      );
    }

    const qtyBefore = onHand;
    const qtyAfter = Math.max(0, qtyBefore - qty);

    const update = {
      $inc: {
        quantity_on_hand: -qty,
      },
      $set: {
        updated_by_admin: adminId,
      },
    };

    if (type === "counter_sale") {
      update.$inc.total_sold_quantity = qty;
      update.$inc.manual_sold_quantity = qty;
    } else {
      update.$inc.manual_reduced_quantity = qty;
    }

    const updatedInventory = await FranchiseInventory.findByIdAndUpdate(
      inventory._id,
      update,
      { new: true }
    );

    // Create Audit Log Entry
    const OutletStockLog = require("../../models/outletStockLogModel");
    const log = await OutletStockLog.create({
      franchise: franchiseId,
      product: productId,
      variant_sku: variantSku || inventory.variant_sku || null,
      sku: sku || inventory.sku || "",
      quantity: qty,
      type,
      quantity_before: qtyBefore,
      quantity_after: qtyAfter,
      reason: reason || (type === "counter_sale" ? "Manual counter / offline sale" : "Manual stock reduction"),
      recorded_by: adminId,
      recorded_by_name: adminName,
      recorded_by_role: adminRole,
    });

    return {
      inventory: updatedInventory,
      log,
    };
  }

  /**
   * Get paginated deduction & offline sales logs for an outlet
   */
  async getLogs({
    franchiseId,
    productId = null,
    page = 1,
    per_page = 50,
    type = null,
  }) {
    const OutletStockLog = require("../../models/outletStockLogModel");

    // Auto-sync any existing picked up orders to OutletStockLog if not yet recorded
    try {
      const Order = require("../../models/orderModel");
      const unloggedOrders = await Order.find({
        fulfillmentType: "pickup",
        pickupStatus: "picked_up",
      }).limit(50).lean();

      for (const ord of unloggedOrders) {
        for (const itm of ord.items || []) {
          const prodId = itm.product?._id || itm.product;
          if (!prodId) continue;
          const exists = await OutletStockLog.exists({
            order: ord._id,
            product: prodId,
          });
          if (!exists) {
            await OutletStockLog.create({
              franchise: ord.franchise,
              product: prodId,
              variant_sku: itm.variant_sku || null,
              sku: itm.product?.sku || "",
              quantity: itm.quantity,
              type: "online_sale",
              order: ord._id,
              order_number: ord.orderNumber,
              customer_name: ord.guestInfo?.name || ord.address?.name || "App Customer",
              reason: `Customer online app order #${ord.orderNumber} picked up`,
              createdAt: ord.pickedUpAt || ord.updatedAt || ord.createdAt,
            });
          }
        }
      }
    } catch (err) {
      // Non-fatal, proceed with query
    }

    const query = {};

    if (franchiseId && franchiseId !== "all") {
      query.franchise = franchiseId;
    }
    if (productId) {
      query.product = productId;
    }
    if (type && type !== "all") {
      if (type === "online_sale" || type === "online") {
        query.type = { $in: ["online_sale", "online_pickup"] };
      } else if (type === "counter_sale" || type === "counter" || type === "offline") {
        query.type = "counter_sale";
      } else if (type === "damage" || type === "waste_spoilage") {
        query.type = { $in: ["damage", "waste_spoilage"] };
      } else {
        query.type = type;
      }
    }

    const baseStatsQuery = {};
    if (franchiseId && franchiseId !== "all") {
      baseStatsQuery.franchise = franchiseId;
    }
    if (productId) {
      baseStatsQuery.product = productId;
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(per_page);

    const [logs, total, onlineCount, offlineCount, damageCount, adjustmentCount] = await Promise.all([
      OutletStockLog.find(query)
        .populate("franchise", "name outletCode address city phone")
        .populate("product", "name sku banner_image unit dairyCategory price discounted_price")
        .populate("recorded_by", "name email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(per_page))
        .lean(),
      OutletStockLog.countDocuments(query),
      OutletStockLog.countDocuments({ ...baseStatsQuery, type: { $in: ["online_sale", "online_pickup"] } }),
      OutletStockLog.countDocuments({ ...baseStatsQuery, type: "counter_sale" }),
      OutletStockLog.countDocuments({ ...baseStatsQuery, type: { $in: ["damage", "waste_spoilage"] } }),
      OutletStockLog.countDocuments({ ...baseStatsQuery, type: "adjustment" }),
    ]);

    return {
      logs,
      total,
      stats: {
        all: onlineCount + offlineCount + damageCount + adjustmentCount,
        online_sales: onlineCount,
        counter_sales: offlineCount,
        damage: damageCount,
        adjustment: adjustmentCount,
      },
      page: Number(page),
      per_page: Number(per_page),
      total_pages: Math.ceil(total / Number(per_page)),
    };
  }
}

module.exports = new FranchiseInventoryService();
