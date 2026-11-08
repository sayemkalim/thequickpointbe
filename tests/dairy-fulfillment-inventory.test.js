const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const DairyOrderService = require("../services/dairyOrder/index");

describe("Dairy & Non-Dairy Fulfillment & Inventory Routing Architecture", () => {
  test("1. Order and OrderItem schemas support inventorySource tracking", () => {
    const validId = new mongoose.Types.ObjectId();
    const order = new Order({
      orderNumber: 99999,
      fulfillmentType: "delivery",
      inventorySource: "central",
      items: [
        {
          product: {
            _id: validId,
            name: "Chura 1Kg",
            price: 100,
            isDairy: false,
          },
          quantity: 2,
          total_amount: 200,
          discounted_total_amount: 200,
          inventorySource: "central",
        },
        {
          product: {
            _id: validId,
            name: "Paneer 200g",
            price: 90,
            isDairy: true,
          },
          quantity: 1,
          total_amount: 90,
          discounted_total_amount: 90,
          inventorySource: "outlet",
        },
      ],
    });

    assert.equal(order.inventorySource, "central");
    assert.equal(order.items[0].inventorySource, "central");
    assert.equal(order.items[1].inventorySource, "outlet");
  });

  test("2. DairyOrderService exports commitOrderStock and releaseOrderStock methods", () => {
    assert.equal(typeof DairyOrderService.commitOrderStock, "function");
    assert.equal(typeof DairyOrderService.releaseOrderStock, "function");
    assert.equal(typeof DairyOrderService.createDairyOrder, "function");
    assert.equal(typeof DairyOrderService.confirmOrderPayment, "function");
    assert.equal(typeof DairyOrderService.cancelDairyOrder, "function");
  });

  test("3. DairyOrderService rejects dairy product (isDairy: true) for Home Delivery", async () => {
    const fakeDairyId = new mongoose.Types.ObjectId();
    const Product = require("../models/productsModel");

    const originalFindById = Product.findById;
    Product.findById = (id) => ({
      lean: async () => ({
        _id: id,
        name: "Sudha Milk 500ml",
        price: 30,
        discounted_price: 30,
        isDairy: true,
      }),
    });

    try {
      await assert.rejects(
        async () => {
          await DairyOrderService.createDairyOrder({
            items: [{ productId: fakeDairyId, quantity: 1 }],
            customerPhone: "9876543210",
            fulfillmentType: "delivery",
          });
        },
        /is only available for Store Takeaway/
      );
    } finally {
      Product.findById = originalFindById;
    }
  });
});

