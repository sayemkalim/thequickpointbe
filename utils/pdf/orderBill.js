const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

// Converts numbers to Indian currency words
function numberToWordsIndian(num) {
  const rounded = Math.round(Number(num) || 0);
  if (rounded <= 0) return "Zero Rupees Only";

  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const formatTens = (n) => {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + a[n % 10] : "");
  };

  let n = rounded;
  let parts = [];

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  n %= 100;

  if (crore > 0) parts.push(formatTens(crore) + " Crore");
  if (lakh > 0) parts.push(formatTens(lakh) + " Lakh");
  if (thousand > 0) parts.push(formatTens(thousand) + " Thousand");
  if (hundred > 0) parts.push(formatTens(hundred) + " Hundred");
  if (n > 0) parts.push(formatTens(n));

  return parts.join(" ") + " Rupees Only";
}

const LOGO_PATH = path.join(
  __dirname,
  "..",
  "..",
  "public",
  "email-assets",
  "quickpoint-logo.png"
);

const COMPANY_NAME = "THE QUICK POINT";
const COMPANY_ADDRESS = "Behind HDFC Bank Barbigha, Dist.- Sheikhpura (Bihar) 811101";
const COMPANY_FSSAI = "FASSI No. 20424181000174";
const COMPANY_PHONE = "+91 94707 70350";
const COMPANY_GSTIN = "10BETPK0389C2ZN, State: 10-Bihar";
const COMPANY_SUPPORT_EMAIL = "thequickpointbarbigha@gmail.com";

const PAGE_MARGIN = 36;
const PAGE_WIDTH = 523;
const PURPLE = "#8580db";
const PURPLE_BANNER = "#9490e0";

/**
 * Builds the exact Purple-themed Customer Tax Invoice PDF buffer matching Print Invoice design.
 */
const buildOrderBillPdfBuffer = async ({ order, customer }) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: PAGE_MARGIN,
        info: {
          Title: `Invoice_${order.orderNumber || order._id}`,
          Author: COMPANY_NAME,
          Subject: "Customer Tax Invoice",
        },
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      // 1. Top Header Row
      if (fs.existsSync(LOGO_PATH)) {
        try {
          doc.image(LOGO_PATH, PAGE_MARGIN, 32, { width: 62, height: 62, fit: [62, 62] });
        } catch (imgErr) {
          console.warn("Could not render logo in PDFKit:", imgErr.message);
        }
      }

      // Company Info (Right aligned)
      const compX = 230;
      const compW = 329;
      doc.font("Helvetica").fontSize(7.5).fillColor("#9ca3af")
         .text("ORIGINAL FOR RECIPIENT", compX, 30, { width: compW, align: "right" });
      doc.font("Helvetica-Bold").fontSize(15).fillColor("#111827")
         .text(COMPANY_NAME, compX, 42, { width: compW, align: "right" });
      doc.font("Helvetica").fontSize(7.5).fillColor("#4b5563")
         .text(COMPANY_ADDRESS, compX, 60, { width: compW, align: "right" })
         .text(COMPANY_FSSAI, compX, 71, { width: compW, align: "right" })
         .text(`Phone no.: ${COMPANY_PHONE}   Email: ${COMPANY_SUPPORT_EMAIL}`, compX, 82, { width: compW, align: "right" })
         .text(`GSTIN: ${COMPANY_GSTIN}`, compX, 93, { width: compW, align: "right" });

      // 2. Purple "Invoice" Banner Bar
      let y = 114;
      doc.rect(PAGE_MARGIN, y, PAGE_WIDTH, 20).fill(PURPLE);
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11)
         .text("Invoice", PAGE_MARGIN, y + 4.5, { width: PAGE_WIDTH, align: "center" });

      // 3. 3-Column Info Strip: Bill To | Ship To | Invoice Details
      y += 28;
      const customerName =
        customer?.name ||
        order.address?.name ||
        order.guestInfo?.name ||
        order.user?.name ||
        "Customer";

      const rawAddr = order.address || order.shippingAddress || order.franchise?.address;
      const streetPart =
        typeof rawAddr?.address === "string"
          ? rawAddr.address
          : rawAddr?.addressLine1 || rawAddr?.street || "";
      const localityPart =
        rawAddr?.addressLine2 || rawAddr?.locality || rawAddr?.landmark || "";
      const cityPart = rawAddr?.city || order.franchise?.city || "";
      const statePart = rawAddr?.state || "Bihar";
      const pincodePart = rawAddr?.pincode ? `Bihar- ${rawAddr.pincode}` : "Bihar";

      const addressLines = [streetPart, localityPart, cityPart, statePart, pincodePart]
        .filter((part) => typeof part === "string" && part.trim() !== "")
        .join(", ");

      const contactNo =
        customer?.mobile ||
        order.address?.mobile ||
        order.address?.phone ||
        order.guestInfo?.mobile ||
        order.user?.phone ||
        order.user?.mobile ||
        "—";

      const invoiceNumber = String(order.orderNumber || order._id || "1").replace(/^#/, "");
      const invoiceDate = order.createdAt
        ? new Date(order.createdAt).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).replace(/\//g, "-")
        : new Date().toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).replace(/\//g, "-");

      // Bill To Column
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#1f2937").text("Bill To", PAGE_MARGIN, y);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827").text(customerName.toUpperCase(), PAGE_MARGIN, y + 13);
      doc.font("Helvetica").fontSize(7.5).fillColor("#4b5563")
         .text(addressLines || "Store Pickup", PAGE_MARGIN, y + 25, { width: 175 });
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#1f2937")
         .text(`Contact No.: ${contactNo}`, PAGE_MARGIN, y + 68);

      // Ship To Column
      const shipToText = order.fulfillmentType === "pickup" ? "STORE PICKUP" : (addressLines || "NONE");
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#1f2937").text("Ship To", 225, y);
      doc.font("Helvetica").fontSize(7.5).fillColor("#4b5563").text(shipToText, 225, y + 13, { width: 140 });

      // Invoice Details Column
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#1f2937").text("Invoice Details", 380, y, { width: 179, align: "right" });
      doc.font("Helvetica").fontSize(8).fillColor("#111827")
         .text(`Invoice No.: ${invoiceNumber}`, 380, y + 13, { width: 179, align: "right" })
         .text(`Date: ${invoiceDate}`, 380, y + 25, { width: 179, align: "right" });

      // Divider line
      y += 82;
      doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + PAGE_WIDTH, y).lineWidth(0.5).strokeColor("#e5e7eb").stroke();

      // 4. Items Table
      y += 10;
      doc.rect(PAGE_MARGIN, y, PAGE_WIDTH, 20).fill(PURPLE);
      const cols = [
        { label: "#", x: PAGE_MARGIN, w: 25, align: "center" },
        { label: "Item name", x: PAGE_MARGIN + 25, w: 165, align: "left" },
        { label: "HSN/ SAC", x: PAGE_MARGIN + 190, w: 55, align: "center" },
        { label: "Quantity", x: PAGE_MARGIN + 245, w: 48, align: "center" },
        { label: "Unit", x: PAGE_MARGIN + 293, w: 40, align: "center" },
        { label: "Price/ Unit", x: PAGE_MARGIN + 333, w: 60, align: "right" },
        { label: "Discount", x: PAGE_MARGIN + 393, w: 55, align: "right" },
        { label: "Amount", x: PAGE_MARGIN + 448, w: 75, align: "right" },
      ];

      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5);
      cols.forEach((c) => {
        doc.text(c.label, c.x, y + 5.5, { width: c.w, align: c.align });
      });

      // Item Rows
      y += 20;
      const items = (order.items || []).map((item, index) => {
        const isBundle = item.type === "bundle";
        const itemData = isBundle ? item.bundle : item.product;
        const name = itemData?.name || item.name || "Item";
        const quantity = Number(item.quantity) || 1;
        const weight =
          item.variant?.weight ||
          item.variant?.weight_in_grams ||
          itemData?.weight ||
          itemData?.weight_in_grams ||
          itemData?.unit ||
          "PCS";
        const unitString = typeof weight === "number" ? `${weight}g` : String(weight);

        const pricePerUnit = Number(
          item.pricePerUnit ||
          item.discounted_price ||
          item.price ||
          itemData?.discounted_price ||
          itemData?.price ||
          0
        );

        const mrp = Number(
          item.original_price ||
          item.mrp ||
          itemData?.mrp ||
          itemData?.price ||
          pricePerUnit
        );

        const discountAmountPerUnit = Math.max(0, mrp - pricePerUnit);
        const totalDiscount = discountAmountPerUnit * quantity;
        const lineTotal = pricePerUnit > 0 ? pricePerUnit * quantity : Number(order.finalTotalAmount || 0);

        return {
          index: index + 1,
          name,
          hsn: itemData?.hsn || item.hsn || "—",
          quantity,
          unit: unitString,
          pricePerUnit: pricePerUnit > 0 ? pricePerUnit : lineTotal / (quantity || 1),
          totalDiscount,
          lineTotal,
        };
      });

      const rowHeight = 22;
      let totalQty = 0;
      let totalDiscountSum = 0;
      let calculatedTotal = 0;

      items.forEach((it) => {
        totalQty += it.quantity;
        totalDiscountSum += it.totalDiscount;
        calculatedTotal += it.lineTotal;

        doc.rect(PAGE_MARGIN, y, PAGE_WIDTH, rowHeight).fill("#ffffff");
        doc.fillColor("#6b7280").font("Helvetica").fontSize(8).text(String(it.index), cols[0].x, y + 6, { width: cols[0].w, align: cols[0].align });
        doc.fillColor("#111827").font("Helvetica-Bold").fontSize(8).text(it.name, cols[1].x, y + 6, { width: cols[1].w, align: cols[1].align });
        doc.fillColor("#6b7280").font("Helvetica").fontSize(8).text(it.hsn, cols[2].x, y + 6, { width: cols[2].w, align: cols[2].align });
        doc.fillColor("#111827").font("Helvetica-Bold").fontSize(8).text(String(it.quantity), cols[3].x, y + 6, { width: cols[3].w, align: cols[3].align });
        doc.fillColor("#4b5563").font("Helvetica").fontSize(8).text(it.unit.toUpperCase(), cols[4].x, y + 6, { width: cols[4].w, align: cols[4].align });
        doc.fillColor("#111827").font("Helvetica").fontSize(8).text(`₹ ${it.pricePerUnit.toFixed(2)}`, cols[5].x, y + 6, { width: cols[5].w, align: cols[5].align });
        doc.fillColor("#6b7280").font("Helvetica").fontSize(8).text(it.totalDiscount > 0 ? `₹ ${it.totalDiscount.toFixed(2)}` : "—", cols[6].x, y + 6, { width: cols[6].w, align: cols[6].align });
        doc.fillColor("#111827").font("Helvetica-Bold").fontSize(8).text(`₹ ${it.lineTotal.toFixed(2)}`, cols[7].x, y + 6, { width: cols[7].w, align: cols[7].align });

        y += rowHeight;
      });

      const finalTotal = Number(order.finalTotalAmount || calculatedTotal || 0);

      // Total Summary Row in Table
      doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + PAGE_WIDTH, y).lineWidth(1).strokeColor("#374151").stroke();
      doc.moveTo(PAGE_MARGIN, y + 22).lineTo(PAGE_MARGIN + PAGE_WIDTH, y + 22).lineWidth(1).strokeColor("#374151").stroke();

      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(8.5);
      doc.text("TOTAL", cols[1].x, y + 6, { width: cols[1].w, align: "left" });
      doc.text(String(totalQty || 1), cols[3].x, y + 6, { width: cols[3].w, align: "center" });
      doc.text(totalDiscountSum > 0 ? `₹ ${totalDiscountSum.toFixed(2)}` : "—", cols[6].x, y + 6, { width: cols[6].w, align: "right" });
      doc.text(`₹ ${finalTotal.toFixed(2)}`, cols[7].x, y + 6, { width: cols[7].w, align: "right" });

      // 5. Bottom 4 Purple Banners (Full-width stacked)
      const amountInWords = numberToWordsIndian(finalTotal);
      const isPaid = order.paymentStatus === "completed" || order.paymentStatus === "paid" || order.status === "delivered";
      const paymentType = order.paymentMode
        ? order.paymentMode.toUpperCase() === "COD"
          ? order.codPaymentMethod
            ? `COD (${order.codPaymentMethod.toUpperCase()})`
            : "Cash on Delivery"
          : order.paymentMode.toUpperCase()
        : "ONLINE";
      const receivedAmount = isPaid ? finalTotal : 0;

      // Section 1: INVOICE AMOUNT IN WORDS
      y += 34;
      doc.rect(PAGE_MARGIN, y, PAGE_WIDTH, 16).fill(PURPLE_BANNER);
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5).text("INVOICE AMOUNT IN WORDS", PAGE_MARGIN + 8, y + 4.5);
      y += 20;
      doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(8.5).text(amountInWords, PAGE_MARGIN + 8, y);

      // Section 2: PAYMENT TYPE
      y += 20;
      doc.rect(PAGE_MARGIN, y, PAGE_WIDTH, 16).fill(PURPLE_BANNER);
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5).text("PAYMENT TYPE", PAGE_MARGIN + 8, y + 4.5);
      y += 20;
      doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(8.5).text(paymentType, PAGE_MARGIN + 8, y);

      // Section 3: TERMS AND CONDITIONS
      y += 20;
      doc.rect(PAGE_MARGIN, y, PAGE_WIDTH, 16).fill(PURPLE_BANNER);
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5).text("TERMS AND CONDITIONS", PAGE_MARGIN + 8, y + 4.5);
      y += 20;
      doc.fillColor("#4b5563").font("Helvetica").fontSize(7.5).text("Orders once delivered will not be taken back or exchanged", PAGE_MARGIN + 8, y);

      // Section 4: AMOUNTS
      y += 20;
      doc.rect(PAGE_MARGIN, y, PAGE_WIDTH, 16).fill(PURPLE_BANNER);
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5).text("AMOUNTS", PAGE_MARGIN + 8, y + 4.5);
      y += 20;

      // Sub Total
      doc.fillColor("#374151").font("Helvetica").fontSize(8.5);
      doc.text("Sub Total", PAGE_MARGIN + 8, y);
      doc.text(`₹ ${finalTotal.toFixed(2)}`, PAGE_MARGIN + PAGE_WIDTH - 100, y, { width: 92, align: "right" });

      // Total
      y += 16;
      doc.font("Helvetica-Bold").fontSize(9);
      doc.text("Total", PAGE_MARGIN + 8, y);
      doc.text(`₹ ${finalTotal.toFixed(2)}`, PAGE_MARGIN + PAGE_WIDTH - 100, y, { width: 92, align: "right" });

      // Received
      y += 16;
      doc.font("Helvetica").fontSize(8.5);
      doc.text("Received", PAGE_MARGIN + 8, y);
      doc.font("Helvetica-Bold").text(`₹ ${receivedAmount.toFixed(2)}`, PAGE_MARGIN + PAGE_WIDTH - 100, y, { width: 92, align: "right" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

module.exports = {
  buildOrderBillPdfBuffer,
  numberToWordsIndian,
};
