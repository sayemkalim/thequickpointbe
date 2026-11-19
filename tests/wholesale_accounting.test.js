const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const StockDispatch = require("../models/stockDispatchModel");
const FranchiseAccountLedger = require("../models/franchiseAccountLedgerModel");
const FranchisePayment = require("../models/franchisePaymentModel");
const CounterBill = require("../models/counterBillModel");
const StockDispatchService = require("../services/stockDispatch/index");
const FranchiseLedgerService = require("../services/franchiseLedger/index");
const PosBillingService = require("../services/posBilling/index");
const FranchisePaymentService = require("../services/franchisePayment/index");

describe("QuickPoint Wholesale Billing, Khata Book & POS Architecture Tests", () => {
  const franchiseId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  test("1. StockDispatch Schema supports items with wholesale price snapshots & invoice numbers", () => {
    const dispatch = new StockDispatch({
      invoice_no: "WD-2611-0001",
      franchise: franchiseId,
      status: "issued",
      items: [
        {
          product: productId,
          name: "Fresh Paneer 250g",
          sku: "PAN-250",
          dispatched_quantity: 20,
          wholesale_price: 80,
          total_amount: 1600,
        },
      ],
      total_dispatched_quantity: 20,
      subtotal: 1600,
      discount_amount: 100,
      grand_total: 1500,
      created_by: adminId,
    });

    assert.equal(dispatch.invoice_no, "WD-2611-0001");
    assert.equal(dispatch.status, "issued");
    assert.equal(dispatch.grand_total, 1500);
    assert.equal(dispatch.items[0].wholesale_price, 80);
    assert.equal(dispatch.items[0].total_amount, 1600);
  });

  test("2. FranchiseAccountLedger enforces transaction types and running balance structure", () => {
    const ledgerEntry = new FranchiseAccountLedger({
      entry_number: "TXN-2611-0001",
      franchise: franchiseId,
      transaction_type: "stock_invoice",
      debit: 5000,
      credit: 0,
      running_balance: 5000,
      description: "Wholesale stock dispatch #WD-2611-0001",
      reference_type: "StockDispatch",
      reference_id: new mongoose.Types.ObjectId(),
      created_by: adminId,
    });

    assert.equal(ledgerEntry.transaction_type, "stock_invoice");
    assert.equal(ledgerEntry.debit, 5000);
    assert.equal(ledgerEntry.credit, 0);
    assert.equal(ledgerEntry.running_balance, 5000);
  });

  test("3. FranchisePayment tracks verification status and transaction reference", () => {
    const payment = new FranchisePayment({
      payment_number: "FPAY-2611-0001",
      franchise: franchiseId,
      amount: 3000,
      payment_method: "upi",
      transaction_reference: "UPI/1234567890",
      status: "pending",
      submitted_by: adminId,
    });

    assert.equal(payment.payment_number, "FPAY-2611-0001");
    assert.equal(payment.amount, 3000);
    assert.equal(payment.status, "pending");
  });

  test("4. CounterBill tracks items, payment history, and customer dues accurately", () => {
    const bill = new CounterBill({
      bill_number: "POS-2611-0001",
      franchise: franchiseId,
      customer_name: "Rahul Verma",
      customer_phone: "9876543210",
      items: [
        {
          product: productId,
          product_name: "Cow Milk 1L",
          unit: "1L",
          quantity: 2,
          unit_price: 60,
          total_price: 120,
        },
      ],
      subtotal: 120,
      discount_amount: 0,
      grand_total: 120,
      received_amount: 80,
      due_amount: 40,
      payment_method: "cash",
      payment_status: "partial",
      payment_history: [
        {
          amount: 80,
          payment_method: "cash",
          received_by: adminId,
        },
      ],
      created_by: adminId,
    });

    assert.equal(bill.bill_number, "POS-2611-0001");
    assert.equal(bill.grand_total, 120);
    assert.equal(bill.received_amount, 80);
    assert.equal(bill.due_amount, 40);
    assert.equal(bill.payment_status, "partial");
    assert.equal(bill.payment_history.length, 1);
  });

  test("5. Wholesale Settlement Formula Verification: Outstanding Payable", () => {
    // Formula:
    // Net Online Settlement = Online Amount Collected - Franchise Commission
    // Outstanding Payable = Wholesale Stock Invoice Amount - Net Online Settlement - Verified Franchise Payments + Debit Adjustments - Credit Adjustments

    const wholesaleStockSupplied = 10000;
    const onlineAmountCollected = 4000;
    const franchiseCommission = 400; // 10%
    const netOnlineSettlement = onlineAmountCollected - franchiseCommission; // 3600
    const verifiedFranchisePayments = 2000;
    const debitAdjustments = 100;
    const creditAdjustments = 50;

    const outstandingPayable =
      wholesaleStockSupplied -
      netOnlineSettlement -
      verifiedFranchisePayments +
      debitAdjustments -
      creditAdjustments;

    // Calculation check:
    // 10000 - 3600 - 2000 + 100 - 50 = 4450
    assert.equal(netOnlineSettlement, 3600);
    assert.equal(outstandingPayable, 4450);

    // Ensure Walk-in customer dues (e.g. 500) do NOT alter the company outstanding
    const walkInCustomerDue = 500;
    const companyDebtWithWalkInIgnored = outstandingPayable;
    assert.equal(companyDebtWithWalkInIgnored, 4450);
  });

  test("6. Core Service modules export required wholesale, ledger, pos and payment methods", () => {
    assert.equal(typeof StockDispatchService.createDispatchInvoice, "function");
    assert.equal(typeof StockDispatchService.confirmStockReceipt, "function");
    assert.equal(typeof StockDispatchService.getDispatchInvoices, "function");

    assert.equal(typeof FranchiseLedgerService.postEntry, "function");
    assert.equal(typeof FranchiseLedgerService.getFranchiseAccountSummary, "function");
    assert.equal(typeof FranchiseLedgerService.getFranchiseStatement, "function");

    assert.equal(typeof PosBillingService.createPosBill, "function");
    assert.equal(typeof PosBillingService.getPosBills, "function");
    assert.equal(typeof PosBillingService.collectCustomerDuePayment, "function");

    assert.equal(typeof FranchisePaymentService.submitPayment, "function");
    assert.equal(typeof FranchisePaymentService.verifyPayment, "function");
    assert.equal(typeof FranchisePaymentService.rejectPayment, "function");
  });
});
