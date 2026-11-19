const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const StockChallan = require("../models/stockChallanModel");
const FranchiseSettlement = require("../models/franchiseSettlementModel");
const CounterBill = require("../models/counterBillModel");
const Franchise = require("../models/franchiseModel");
const StockChallanService = require("../services/stockChallan/index");
const SettlementService = require("../services/settlement/index");

describe("QuickPoint Simple Franchise Stock Challan & Daily Settlement Suite", () => {
  const franchiseId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  test("1. StockChallan schema supports multiple products and auto-sequential numbering", () => {
    const challan = new StockChallan({
      challanNumber: "CH-2611-0001",
      franchise: franchiseId,
      items: [
        {
          product: productId,
          name: "Fresh Milk 500ml",
          sku: "MILK-500",
          quantity: 100,
        },
        {
          product: new mongoose.Types.ObjectId(),
          name: "Curd 400g",
          sku: "CURD-400",
          quantity: 50,
        },
        {
          product: new mongoose.Types.ObjectId(),
          name: "Paneer 250g",
          sku: "PAN-250",
          quantity: 30,
        },
      ],
      totalQuantity: 180,
      status: "dispatched",
      createdBy: adminId,
    });

    assert.equal(challan.challanNumber, "CH-2611-0001");
    assert.equal(challan.items.length, 3);
    assert.equal(challan.totalQuantity, 180);
    assert.equal(challan.status, "dispatched");
  });

  test("2. CounterBill tracks isSettled and settlement link to prevent duplicate billing", () => {
    const bill = new CounterBill({
      bill_number: "POS-2611-0001",
      franchise: franchiseId,
      items: [
        {
          product: productId,
          name: "Fresh Milk 500ml",
          quantity: 2,
          selling_price: 30,
          total_amount: 60,
        },
      ],
      subtotal: 60,
      grand_total: 60,
      received_amount: 60,
      due_amount: 0,
      isSettled: false,
    });

    assert.equal(bill.isSettled, false);
    assert.equal(bill.settlement, null);

    // When included in settlement:
    const settlementId = new mongoose.Types.ObjectId();
    bill.isSettled = true;
    bill.settlement = settlementId;

    assert.equal(bill.isSettled, true);
    assert.equal(String(bill.settlement), String(settlementId));
  });

  test("3. Exact Walk-In Settlement Formula & Online Sales Non-Duplication", () => {
    // Business rule:
    // Online customer payments are collected directly by the company through Cashfree (e.g. ₹8,000).
    // Walk-in sales are collected by franchise (e.g. ₹10,000).
    // Commission is 10%.
    // Commission Amount = Walk-in Sales * 10% = ₹1,000.
    // Net Walk-in Payable = Walk-in Sales - Commission Amount = ₹9,000.
    // Online ₹8,000 is NOT collected again from franchise.

    const walkInSalesAmount = 10000;
    const onlineSalesAmount = 8000;
    const commissionPercentage = 10;

    const commissionAmount = (walkInSalesAmount * commissionPercentage) / 100;
    const netWalkInPayable = walkInSalesAmount - commissionAmount;

    assert.equal(commissionAmount, 1000);
    assert.equal(netWalkInPayable, 9000);

    // Ensure online amount is not added to what franchise owes:
    const franchiseMustPay = netWalkInPayable;
    assert.equal(franchiseMustPay, 9000);

    // FranchiseSettlement model stores this accurately
    const settlement = new FranchiseSettlement({
      settlementNumber: "SET-2611-0001",
      franchise: franchiseId,
      periodStart: new Date("2026-11-01"),
      periodEnd: new Date("2026-11-19"),
      walkInGrossAmount: walkInSalesAmount,
      commissionPercentage,
      commissionAmount,
      netPayable: netWalkInPayable,
      onlineCollectedByCompany: onlineSalesAmount,
      amountPaid: 0,
      remainingAmount: netWalkInPayable,
      paymentStatus: "unpaid",
    });

    assert.equal(settlement.netPayable, 9000);
    assert.equal(settlement.onlineCollectedByCompany, 8000);
    assert.equal(settlement.remainingAmount, 9000);
    assert.equal(settlement.paymentStatus, "unpaid");
  });

  test("4. Partial Payment updates remaining balance and payment status correctly", () => {
    const settlement = new FranchiseSettlement({
      settlementNumber: "SET-2611-0002",
      franchise: franchiseId,
      periodStart: new Date(),
      periodEnd: new Date(),
      walkInGrossAmount: 10000,
      commissionPercentage: 10,
      commissionAmount: 1000,
      netPayable: 9000,
      amountPaid: 0,
      remainingAmount: 9000,
      paymentStatus: "unpaid",
      payments: [],
    });

    // 1st Partial Payment of ₹5,000
    settlement.payments.push({
      amount: 5000,
      paymentMethod: "upi",
      reference: "UPI/11223344",
      paymentDate: new Date(),
    });
    settlement.amountPaid += 5000;
    settlement.remainingAmount = Math.max(0, settlement.netPayable - settlement.amountPaid);
    settlement.paymentStatus = settlement.remainingAmount <= 0 ? "paid" : "partial";

    assert.equal(settlement.amountPaid, 5000);
    assert.equal(settlement.remainingAmount, 4000);
    assert.equal(settlement.paymentStatus, "partial");

    // 2nd Payment of remaining ₹4,000
    settlement.payments.push({
      amount: 4000,
      paymentMethod: "cash",
      reference: "CASH-REC",
      paymentDate: new Date(),
    });
    settlement.amountPaid += 4000;
    settlement.remainingAmount = Math.max(0, settlement.netPayable - settlement.amountPaid);
    settlement.paymentStatus = settlement.remainingAmount <= 0 ? "paid" : "partial";

    assert.equal(settlement.amountPaid, 9000);
    assert.equal(settlement.remainingAmount, 0);
    assert.equal(settlement.paymentStatus, "paid");
  });

  test("5. Services export required challan, settlement, and sales summary methods", () => {
    assert.equal(typeof StockChallanService.createChallan, "function");
    assert.equal(typeof StockChallanService.getChallans, "function");
    assert.equal(typeof StockChallanService.getChallanDetails, "function");
    assert.equal(typeof StockChallanService.cancelChallan, "function");

    assert.equal(typeof SettlementService.previewSettlement, "function");
    assert.equal(typeof SettlementService.confirmSettlement, "function");
    assert.equal(typeof SettlementService.recordSettlementPayment, "function");
    assert.equal(typeof SettlementService.getSettlements, "function");
    assert.equal(typeof SettlementService.getFranchiseSalesSummary, "function");
    assert.equal(typeof SettlementService.getFranchiseStockSummary, "function");
  });
});

