const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const OutletChallan = require("../models/outletChallanModel");
const OutletBillingSettlement = require("../models/outletBillingSettlementModel");

test("QuickPoint Simple Outlet Billing & Challan Model Suite", async (t) => {
  await t.test("1. OutletChallan stores items, rates, and total amounts", () => {
    const challan = new OutletChallan({
      challanNumber: "CH-261120-0001",
      franchise: new mongoose.Types.ObjectId(),
      items: [
        {
          product: new mongoose.Types.ObjectId(),
          name: "Fresh Cow Milk 1L",
          sku: "MILK-001",
          quantity: 50,
          price: 60,
          amount: 3000,
        },
        {
          product: new mongoose.Types.ObjectId(),
          name: "Fresh Paneer 500g",
          sku: "PAN-001",
          quantity: 20,
          price: 200,
          amount: 4000,
        },
      ],
      totalQuantity: 70,
      totalAmount: 7000,
      status: "active",
    });

    assert.equal(challan.challanNumber, "CH-261120-0001");
    assert.equal(challan.totalQuantity, 70);
    assert.equal(challan.totalAmount, 7000);
    assert.equal(challan.status, "active");
  });

  await t.test("2. Exact 5-Step Billing Calculation: Challan Udhar - Online Sales = Rest Amount - Commission = Outlet Dega", () => {
    const totalChallanAmount = 10000;
    const onlineSalesAmount = 3000;
    const restAmount = totalChallanAmount - onlineSalesAmount; // 7000
    const commissionPercentage = 10;
    const commissionAmount = (restAmount * commissionPercentage) / 100; // 700
    const netPayable = restAmount - commissionAmount; // 6300

    const settlement = new OutletBillingSettlement({
      billNumber: "BILL-261120-0001",
      franchise: new mongoose.Types.ObjectId(),
      periodStart: new Date(),
      periodEnd: new Date(),
      totalChallanAmount,
      onlineSalesAmount,
      restAmount,
      commissionPercentage,
      commissionAmount,
      netPayable,
      amountPaid: 0,
      remainingAmount: netPayable,
      paymentStatus: "unpaid",
    });

    assert.equal(settlement.totalChallanAmount, 10000);
    assert.equal(settlement.onlineSalesAmount, 3000);
    assert.equal(settlement.restAmount, 7000);
    assert.equal(settlement.commissionAmount, 700);
    assert.equal(settlement.netPayable, 6300);
    assert.equal(settlement.remainingAmount, 6300);
    assert.equal(settlement.paymentStatus, "unpaid");
  });

  await t.test("3. Payment Recording updates remaining balance and status", () => {
    const bill = new OutletBillingSettlement({
      billNumber: "BILL-261120-0002",
      franchise: new mongoose.Types.ObjectId(),
      periodStart: new Date(),
      periodEnd: new Date(),
      totalChallanAmount: 10000,
      onlineSalesAmount: 4000,
      restAmount: 6000,
      commissionPercentage: 10,
      commissionAmount: 600,
      netPayable: 5400,
      amountPaid: 0,
      remainingAmount: 5400,
      paymentStatus: "unpaid",
    });

    // Record partial payment
    bill.payments.push({
      amount: 3000,
      paymentMethod: "upi",
      reference: "UPI12345678",
      date: new Date(),
    });
    bill.amountPaid += 3000;
    bill.remainingAmount = bill.netPayable - bill.amountPaid;
    bill.paymentStatus = bill.remainingAmount <= 0 ? "paid" : "partial";

    assert.equal(bill.amountPaid, 3000);
    assert.equal(bill.remainingAmount, 2400);
    assert.equal(bill.paymentStatus, "partial");

    // Settle remaining balance
    bill.payments.push({
      amount: 2400,
      paymentMethod: "cash",
      reference: "CASH-PAID",
      date: new Date(),
    });
    bill.amountPaid += 2400;
    bill.remainingAmount = bill.netPayable - bill.amountPaid;
    bill.paymentStatus = bill.remainingAmount <= 0 ? "paid" : "partial";

    assert.equal(bill.amountPaid, 5400);
    assert.equal(bill.remainingAmount, 0);
    assert.equal(bill.paymentStatus, "paid");
  });
});

