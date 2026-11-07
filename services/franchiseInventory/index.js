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
      const soldQty = inv.total_sold_quantity || 0;
      const onHandQty = inv.quantity_on_hand || 0;
      const reservedQty = inv.reserved_quantity || 0;
      const restockedQty =
        inv.total_restocked_quantity && inv.total_restocked_quantity > 0
          ? inv.total_restocked_quantity
          : onHandQty + soldQty;
      const availableQty = Math.max(0, onHandQty - reservedQty);

      return {
        ...inv,
        total_restocked_quantity: restockedQty,
        total_sold_quantity: soldQty,
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

          // Check stock in Central Inventory (Inventory model)
          const Inventory = require("../../models/inventoryModel");
          let centralInv = await Inventory.findOne({
            product: productId,
            ...(variantSku ? { variant_sku: variantSku } : {}),
          });
          if (!centralInv && !variantSku) {
            centralInv = await Inventory.findOne({ product: productId });
          }

          // Check stock in Product catalog
          const productDoc = await Product.findById(productId);
          let productStock = 0;
          if (productDoc) {
            if (variantSku && Array.isArray(productDoc.variants)) {
              const matchedVariant = productDoc.variants.find(
                (v) => v.sku === variantSku || String(v._id) === String(variantSku)
              );
              productStock = Number(
                matchedVariant?.available_inventory ??
                matchedVariant?.inventory ??
                0
              );
            } else {
              productStock = Number(
                productDoc.base_available_inventory ??
                productDoc.available_inventory ??
                productDoc.qty_on_hand ??
                productDoc.inventory ??
                0
              );
            }
          }

          const centralAvailable = centralInv
            ? Math.max(0, (centralInv.quantity_on_hand || 0) - (centralInv.reserved_quantity || 0))
            : 0;

          const sourceStock = Math.max(centralAvailable, productStock);

          if (sourceStock >= requestedQty) {
            if (current) {
              // Outlet record exists but had 0 or insufficient stock; sync from Central Inventory
              const newQtyOnHand = Math.max(Number(current.quantity_on_hand || 0), sourceStock);
              await FranchiseInventory.updateOne(
                { _id: current._id },
                {
                  $set: { quantity_on_hand: newQtyOnHand },
                  $inc: { reserved_quantity: requestedQty },
                }
              );
              reservedItems.push({
                productId,
                variantSku,
                quantity: requestedQty,
              });
              continue;
            } else {
              // Outlet record doesn't exist yet; create it from Central Inventory
              try {
                await FranchiseInventory.create({
                  franchise: franchiseId,
                  product: productId,
                  variant_sku: variantSku,
                  sku: variantSku || productDoc?.sku || centralInv?.sku || "SKU",
                  quantity_on_hand: sourceStock,
                  reserved_quantity: requestedQty,
                  low_stock_threshold: 5,
                  last_restocked_at: new Date(),
                });
                reservedItems.push({
                  productId,
                  variantSku,
                  quantity: requestedQty,
                });
                continue;
              } catch (createErr) {
                const retryUpdated = await FranchiseInventory.findOneAndUpdate(
                  query,
                  { $inc: { reserved_quantity: requestedQty } },
                  { new: true }
                );
                if (retryUpdated) {
                  reservedItems.push({
                    productId,
                    variantSku,
                    quantity: requestedQty,
                  });
                  continue;
                }
              }
            }
          }

          const available = current
            ? Math.max(0, (current.quantity_on_hand || 0) - (current.reserved_quantity || 0))
            : sourceStock;

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
          },
        }
      );
    }
  }
}

module.exports = new FranchiseInventoryService();
