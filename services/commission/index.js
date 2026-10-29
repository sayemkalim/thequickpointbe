const StoreSettings = require("../../models/storeSettingsModel");
const CommissionLedger = require("../../models/commissionLedgerModel");
const Franchise = require("../../models/franchiseModel");
const Product = require("../../models/productsModel");

class CommissionService {
  /**
   * Resolves effective commission rate and calculates earnings snapshot for an order.
   * Priority: Product Override > Franchise Override > Global Store Setting.
   */
  async calculateOrderCommission(order, franchise = null) {
    let resolvedFranchise = franchise;
    if (!resolvedFranchise && order.franchise) {
      resolvedFranchise = await Franchise.findById(order.franchise).lean();
    }

    let storeSettings = await StoreSettings.findOne().lean();
    if (!storeSettings) {
      storeSettings = {
        commission: {
          type: "percentage",
          value: 10,
        },
      };
    }

    const globalCommission = storeSettings.commission || {
      type: "percentage",
      value: 10,
    };

    let totalOutletCommission = 0;
    let totalPlatformCommission = 0;
    const breakdown = [];

    const items = order.items || [];
    let totalQty = 0;

    for (const item of items) {
      const qty = Number(item.quantity || 1);
      totalQty += qty;

      const itemAmount = Number(
        item.discounted_total_amount || item.total_amount || 0
      );
      const unitPrice = qty > 0 ? itemAmount / qty : 0;

      // Check product-level override
      let rateType = null;
      let rateValue = null;

      const product = item.product;
      if (product) {
        if (product.perPieceCommission !== undefined && product.perPieceCommission !== null) {
          rateType = "fixed_per_piece";
          rateValue = Number(product.perPieceCommission);
        } else if (
          product.commissionPercentage !== undefined &&
          product.commissionPercentage !== null
        ) {
          rateType = "percentage";
          rateValue = Number(product.commissionPercentage);
        }
      }

      // If no product override, check franchise override
      if (rateType === null && resolvedFranchise?.commissionOverride?.enabled) {
        rateType = resolvedFranchise.commissionOverride.type || "percentage";
        rateValue = Number(resolvedFranchise.commissionOverride.value || 10);
      }

      // If still no override, use global store settings
      if (rateType === null) {
        rateType = globalCommission.type || "percentage";
        rateValue = Number(globalCommission.value || 10);
      }

      let outletItemAmount = 0;
      let platformItemAmount = 0;

      if (rateType === "fixed_per_piece") {
        // e.g. ₹2 per packet commission for outlet
        outletItemAmount = rateValue * qty;
        platformItemAmount = Math.max(0, itemAmount - outletItemAmount);
      } else {
        // Percentage commission (e.g., 10% platform commission, 90% outlet earnings)
        platformItemAmount = (itemAmount * rateValue) / 100;
        outletItemAmount = Math.max(0, itemAmount - platformItemAmount);
      }

      totalOutletCommission += outletItemAmount;
      totalPlatformCommission += platformItemAmount;

      breakdown.push({
        productId: product?._id,
        productName: product?.name || "Dairy Item",
        quantity: qty,
        price: unitPrice,
        rateType,
        rateValue,
        outletAmount: Number(outletItemAmount.toFixed(2)),
        platformAmount: Number(platformItemAmount.toFixed(2)),
      });
    }

    return {
      rateType: resolvedFranchise?.commissionOverride?.enabled
        ? resolvedFranchise.commissionOverride.type
        : globalCommission.type,
      rateValue: resolvedFranchise?.commissionOverride?.enabled
        ? resolvedFranchise.commissionOverride.value
        : globalCommission.value,
      outletCommissionAmount: totalOutletCommission.toFixed(2),
      platformCommissionAmount: totalPlatformCommission.toFixed(2),
      calculatedAt: new Date(),
      breakdown,
    };
  }

  /**
   * Finalizes commission to immutable CommissionLedger upon verified pickup.
   * Strictly prevents duplicate records for the same order.
   */
  async recordCommissionLedger(order) {
    if (!order.franchise) return null;

    // Check if ledger record already exists
    const existing = await CommissionLedger.findOne({ order: order._id });
    if (existing) {
      return existing; // Idempotent return
    }

    const snapshot = order.commissionSnapshot;
    if (!snapshot || !snapshot.outletCommissionAmount) {
      // If snapshot wasn't present, compute now
      const calculated = await this.calculateOrderCommission(order);
      order.commissionSnapshot = calculated;
      await order.save();
    }

    const activeSnapshot = order.commissionSnapshot;

    let totalQty = 0;
    (order.items || []).forEach((item) => {
      totalQty += Number(item.quantity || 1);
    });

    try {
      const ledgerEntry = await CommissionLedger.create({
        franchise: order.franchise,
        order: order._id,
        orderNumber: order.orderNumber,
        orderAmount: order.finalTotalAmount || order.totalAmount,
        totalQuantity: totalQty,
        commissionType: activeSnapshot.rateType || "percentage",
        commissionRate: activeSnapshot.rateValue || 10,
        outletCommissionAmount: activeSnapshot.outletCommissionAmount,
        platformCommissionAmount: activeSnapshot.platformCommissionAmount,
        breakdown: activeSnapshot.breakdown || [],
        status: "accrued",
      });

      return ledgerEntry;
    } catch (error) {
      if (error.code === 11000) {
        // Race condition duplicate handled gracefully
        return await CommissionLedger.findOne({ order: order._id });
      }
      throw error;
    }
  }

  /**
   * Log an audit trail entry for commission changes
   */
  async logCommissionChange({ changedBy, franchiseId = null, changeType, previousSetting, newSetting, note, ipAddress = null }) {
    let settings = await StoreSettings.findOne();
    if (!settings) {
      settings = await StoreSettings.create({});
    }

    settings.auditLogs.push({
      changedBy,
      franchise: franchiseId,
      changeType,
      previousSetting,
      newSetting,
      note: note || "Commission rule updated",
      ipAddress,
    });

    await settings.save();
    return settings;
  }
}

module.exports = new CommissionService();
