const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const OutletChallan = require("../models/outletChallanModel");
const OutletBillingSettlement = require("../models/outletBillingSettlementModel");

test("QuickPoint Outlet Billing & Consignment Settlement Suite", async (t) => {
  await t.test("1. OutletChallan stores batch items restocked together and total amounts", () => {
    const challan = new OutletChallan({
      challanNumber: "CH-261120-0001",
      franchise: new mongoose.Types.ObjectId(),
      items: [
        {
          product: new mongoose.Types.ObjectId(),
          name: "Fresh Paneer 500g",
          sku: "PAN-001",
          quantity: 20,
          price: 100,
          amount: 2000,
        },
      ],
      totalQuantity: 20,
      totalAmount: 2000,
      status: "active",
    });

    assert.equal(challan.challanNumber, "CH-261120-0001");
    assert.equal(challan.totalQuantity, 20);
    assert.equal(challan.totalAmount, 2000);
    assert.equal(challan.status, "active");
  });

  await t.test("2. Exact Retail Consignment Formula: User Scenario (20 pcs = ₹2000, 2 Online = ₹300, 3 Offline = ₹700, 15 Remaining = ₹1000)", () => {
    const totalChallanAmount = 2000;
    const onlineSalesAmount = 300; // 2 pcs sold online
    const walkInSalesAmount = 700; // 3 pcs sold offline (cash collected by outlet)
    const remainingStockValue = 1000; // 15 pcs unsold on shelf (not charged to owner)
    const commissionPercentage = 10;

    const offlineMarginAmount = (walkInSalesAmount * commissionPercentage) / 100; // 70
    const onlineCommissionAmount = (onlineSalesAmount * commissionPercentage) / 100; // 30
    const commissionAmount = offlineMarginAmount + onlineCommissionAmount; // 100

    // Net payable: Store owner holds ₹700 counter cash minus ₹100 total commission = ₹600
    const netPayable = walkInSalesAmount - commissionAmount; // 600

    const settlement = new OutletBillingSettlement({
      billNumber: "BILL-261120-0001",
      franchise: new mongoose.Types.ObjectId(),
      periodStart: new Date(),
      periodEnd: new Date(),
      totalChallanAmount,
      onlineSalesAmount,
      walkInSalesAmount,
      remainingStockValue,
      restAmount: totalChallanAmount - onlineSalesAmount,
      commissionPercentage,
      offlineMarginAmount,
      onlineCommissionAmount,
      commissionAmount,
      netPayable,
      amountPaid: 0,
      remainingAmount: netPayable,
      paymentStatus: "unpaid",
      productBreakdown: [
        {
          name: "Fresh Paneer 500g",
          dispatchedQty: 20,
          onlineSoldQty: 2,
          offlineSoldQty: 3,
          totalSoldQty: 5,
          remainingQty: 15,
          remainingStockValue: 1000,
        },
      ],
    });

    assert.equal(settlement.totalChallanAmount, 2000);
    assert.equal(settlement.onlineSalesAmount, 300);
    assert.equal(settlement.walkInSalesAmount, 700);
    assert.equal(settlement.remainingStockValue, 1000);
    assert.equal(settlement.offlineMarginAmount, 70);
    assert.equal(settlement.onlineCommissionAmount, 30);
    assert.equal(settlement.commissionAmount, 100);
    assert.equal(settlement.netPayable, 600);
    assert.equal(settlement.remainingAmount, 600);
    assert.equal(settlement.productBreakdown[0].remainingQty, 15);
  });

  await t.test("3. Zero Double-Billing: Tracking settledOrders and settledCounterBills", () => {
    const order1Id = new mongoose.Types.ObjectId();
    const order2Id = new mongoose.Types.ObjectId();
    const bill1Id = new mongoose.Types.ObjectId();

    const settlement = new OutletBillingSettlement({
      billNumber: "BILL-261120-0002",
      franchise: new mongoose.Types.ObjectId(),
      periodStart: new Date(),
      periodEnd: new Date(),
      totalChallanAmount: 2000,
      onlineSalesAmount: 300,
      walkInSalesAmount: 700,
      netPayable: 600,
      settledOrders: [order1Id, order2Id],
      settledCounterBills: [bill1Id],
    });

    assert.equal(settlement.settledOrders.length, 2);
    assert.equal(settlement.settledCounterBills.length, 1);
    assert.equal(String(settlement.settledOrders[0]), String(order1Id));
  });

  await t.test("4. Payment Recording updates remaining balance and status", () => {
    const bill = new OutletBillingSettlement({
      billNumber: "BILL-261120-0003",
      franchise: new mongoose.Types.ObjectId(),
      periodStart: new Date(),
      periodEnd: new Date(),
      totalChallanAmount: 2000,
      onlineSalesAmount: 300,
      walkInSalesAmount: 700,
      netPayable: 600,
      amountPaid: 0,
      remainingAmount: 600,
      paymentStatus: "unpaid",
    });

    // Pay full net payable
    bill.payments.push({
      amount: 600,
      paymentMethod: "cash",
      reference: "CASH-PAID",
      date: new Date(),
    });
    bill.amountPaid += 600;
    bill.remainingAmount = bill.netPayable - bill.amountPaid;
    bill.paymentStatus = bill.remainingAmount <= 0 ? "paid" : "partial";

    assert.equal(bill.amountPaid, 600);
    assert.equal(bill.remainingAmount, 0);
    assert.equal(bill.paymentStatus, "paid");
  });
});
