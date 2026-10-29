const FranchiseInventory = require("../../models/franchiseInventoryModel");
const Product = require("../../models/productsModel");
const mongoose = require("mongoose");

class FranchiseInventoryService {
  /**
   * List inventory for a specific franchise outlet
   */
  async listByFranchise({ franchiseId, page = 1, per_page = 50, search = "", filter = "all" }) {
    const query = { franchise: franchiseId };

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
        .populate("product", "name sku price discounted_price banner_image isDairy dairyCategory unit")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(per_page)
        .lean(),
      FranchiseInventory.countDocuments(query),
    ]);

    // Calculate available_quantity dynamically
    const formatted = items.map((inv) => ({
      ...inv,
      available_quantity: Math.max(0, (inv.quantity_on_hand || 0) - (inv.reserved_quantity || 0)),
      is_low_stock:
        Math.max(0, (inv.quantity_on_hand || 0) - (inv.reserved_quantity || 0)) <=
        (inv.low_stock_threshold || 10),
    }));

    return {
      items: formatted,
      total,
      page: Number(page),
      per_page: Number(per_page),
      total_pages: Math.ceil(total / per_page),
    };
  }

  /**
   * Restock or set initial stock for an outlet's product
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

    const query = {
      franchise: franchiseId,
      product: productId,
      variant_sku: variantSku || null,
    };

    const update = {
      $inc: { quantity_on_hand: qty },
      $set: {
        sku: resolvedSku,
        last_restocked_at: new Date(),
        updated_by_admin: adminId,
      },
    };

    if (lowStockThreshold !== null) {
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
   * Deducts quantity_on_hand and decrements reserved_quantity
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
          },
        }
      );
    }
  }
}

module.exports = new FranchiseInventoryService();
