const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Product = require("../models/productsModel");

describe("Product Schema & Add/Edit Requirements", () => {
  it("allows non-dairy product creation with category and WITHOUT sub_category or brand", () => {
    const validCatId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();

    const product = new Product({
      name: "Fresh Whole Milk 1L",
      sku: "TEST-MILK-1L",
      price: 66,
      category: validCatId,
      created_by_admin: adminId,
      isDairy: true,
      dairyCategory: "milk",
      unit: "1L",
      attributes: {
        is_best_seller: true,
        is_new_arrival: true,
      },
      is_best_seller: true,
      is_new_arrival: true,
    });

    const validationError = product.validateSync();
    assert.strictEqual(validationError, undefined, "Product should validate cleanly without sub_category");
    assert.strictEqual(product.is_best_seller, true);
    assert.strictEqual(product.is_new_arrival, true);
    assert.strictEqual(product.sub_category, null);
    assert.strictEqual(product.brand, undefined);
  });

  it("non-dairy product does NOT require sub_category anymore", () => {
    const validCatId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();

    const nonDairyProduct = new Product({
      name: "Brown Bread 400g",
      sku: "TEST-BREAD-400G",
      price: 45,
      isDairy: false, // non dairy
      category: validCatId,
      created_by_admin: adminId,
    });

    const validationError = nonDairyProduct.validateSync();
    assert.strictEqual(validationError, undefined, "Non-dairy product must not fail validation when sub_category is missing");
  });

  it("does not require price_tiers (bulk pricing) or variants price_tiers", () => {
    const adminId = new mongoose.Types.ObjectId();

    const product = new Product({
      name: "Paneer Fresh 200g",
      sku: "TEST-PANEER-200G",
      price: 90,
      created_by_admin: adminId,
      variants: [
        {
          sku: "TEST-PANEER-500G",
          name: "500g Pack",
          price: 210,
        },
      ],
    });

    const validationError = product.validateSync();
    assert.strictEqual(validationError, undefined, "Price tiers should not be required");
  });

  it("FranchiseInventoryService and FranchiseService export required methods", () => {
    const FranchiseInventoryService = require("../services/franchiseInventory/index");
    const FranchiseService = require("../services/franchise/index");

    assert.strictEqual(typeof FranchiseInventoryService.reserveStockForOrder, "function");
    assert.strictEqual(typeof FranchiseInventoryService.restock, "function");
    assert.strictEqual(typeof FranchiseService.checkOutletStock, "function");
  });
});

