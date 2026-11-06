const QRCode = require("qrcode");
const crypto = require("crypto");
const Franchise = require("../../models/franchiseModel");
const FranchiseInventory = require("../../models/franchiseInventoryModel");
const StoreSettings = require("../../models/storeSettingsModel");

class FranchiseService {
  /**
   * Generates a QR code data URI and public link for an outlet
   */
  async generateQrForFranchise(franchise) {
    const qrToken =
      franchise.qrToken ||
      `OUT_${franchise.code}_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    
    const baseUrl = process.env.APP_URL || "http://localhost:5000";
    const qrPublicUrl = `${baseUrl}/dairy/outlet/${qrToken}`;

    const qrCodeDataUrl = await QRCode.toDataURL(qrPublicUrl, {
      errorCorrectionLevel: "H",
      type: "image/png",
      margin: 2,
      width: 300,
    });

    franchise.qrToken = qrToken;
    franchise.qrPublicUrl = qrPublicUrl;
    franchise.qrCodeUrl = qrCodeDataUrl;

    return { qrToken, qrPublicUrl, qrCodeDataUrl };
  }

  /**
   * Create a new dairy franchise outlet
   */
  async createFranchise(data) {
    const {
      name,
      code,
      phone,
      email,
      address,
      longitude,
      latitude,
      radiusKm,
      ownerAdmin,
      commissionOverride,
      operatingHours,
    } = data;

    const normalizedCode = code.trim().toUpperCase();

    const existing = await Franchise.findOne({ code: normalizedCode });
    if (existing) {
      throw new Error(`Franchise outlet with code "${normalizedCode}" already exists.`);
    }

    const hasExplicitCoordinates = latitude !== undefined && longitude !== undefined;
    const coordinates = [
      Number(longitude ?? 85.1376), // [lng, lat]
      Number(latitude ?? 25.5941),
    ];

    const franchise = new Franchise({
      name,
      code: normalizedCode,
      slug: normalizedCode.toLowerCase(),
      phone,
      email,
      address,
      location: {
        type: "Point",
        coordinates,
      },
      isLocationVerified: hasExplicitCoordinates,
      radiusKm: radiusKm ? Number(radiusKm) : 15,
      ownerAdmin: ownerAdmin || null,
      commissionOverride: commissionOverride || { enabled: false },
      operatingHours: operatingHours || undefined,
    });

    // Generate QR metadata
    await this.generateQrForFranchise(franchise);

    await franchise.save();
    return franchise;
  }

  /**
   * Update existing franchise outlet
   */
  async updateFranchise(id, data, adminId) {
    const franchise = await Franchise.findById(id);
    if (!franchise) {
      throw new Error("Franchise not found");
    }

    const allowedFields = [
      "name",
      "phone",
      "email",
      "status",
      "radiusKm",
      "operatingHours",
      "ownerAdmin",
    ];

    allowedFields.forEach((field) => {
      if (data[field] !== undefined) {
        franchise[field] = data[field];
      }
    });

    if (data.isActive !== undefined) {
      franchise.status = data.isActive ? "active" : "inactive";
    }

    if (data.code && data.code.trim().toUpperCase() !== franchise.code) {
      const codeUpper = data.code.trim().toUpperCase();
      const existingCode = await Franchise.findOne({ code: codeUpper, _id: { $ne: id } });
      if (existingCode) {
        throw new Error(`Outlet code "${codeUpper}" is already in use by another outlet`);
      }
      franchise.code = codeUpper;
    }

    if (data.address && typeof data.address === "object") {
      const existingAddress = franchise.address ? (franchise.address.toObject ? franchise.address.toObject() : franchise.address) : {};
      franchise.address = {
        ...existingAddress,
        ...data.address,
      };
    } else if (typeof data.address === "string") {
      franchise.address = {
        ...(franchise.address || {}),
        street: data.address,
      };
    }

    if (data.longitude !== undefined && data.latitude !== undefined) {
      franchise.location = {
        type: "Point",
        coordinates: [Number(data.longitude), Number(data.latitude)],
      };
      franchise.isLocationVerified = true;
    }

    // Commission override update with audit note
    if (data.commissionOverride !== undefined) {
      const oldSetting = franchise.commissionOverride;
      franchise.commissionOverride = data.commissionOverride;

      // Log in StoreSettings audit trail
      try {
        let storeSettings = await StoreSettings.findOne();
        if (!storeSettings) {
          storeSettings = await StoreSettings.create({});
        }
        storeSettings.auditLogs.push({
          changedBy: adminId || null,
          franchise: franchise._id,
          changeType: "franchise_commission",
          previousSetting: oldSetting,
          newSetting: data.commissionOverride,
          note: `Commission override updated for outlet ${franchise.code}`,
        });
        await storeSettings.save();
      } catch (logErr) {
        console.error("Failed to log commission audit:", logErr.message);
      }
    }

    await franchise.save();
    return franchise;
  }

  /**
   * Delete or deactivate franchise outlet
   * @param {string} id - Franchise ObjectId
   * @param {Object} options - { hardDelete: boolean }
   */
  async deleteFranchise(id, options = {}) {
    const franchise = await Franchise.findById(id);
    if (!franchise) {
      throw new Error("Franchise outlet not found");
    }

    if (options.hardDelete) {
      await FranchiseInventory.deleteMany({ franchise: id });
      await Franchise.findByIdAndDelete(id);
      return {
        message: "Franchise outlet permanently deleted",
        id,
        hardDeleted: true,
      };
    }

    // Default: Soft delete / deactivate so historical orders and accounting remain intact
    franchise.status = "inactive";
    await franchise.save();
    return {
      message: "Franchise outlet deactivated successfully",
      franchise,
      hardDeleted: false,
    };
  }

  /**
   * Set physical outlet coordinates (GPS) by Franchise Owner or Central Admin
   */
  async updateLocation(franchiseId, { latitude, longitude }) {
    if (latitude === undefined || longitude === undefined) {
      throw new Error("Both latitude and longitude are required");
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error("Valid numerical latitude (-90 to 90) and longitude (-180 to 180) are required");
    }

    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) {
      throw new Error("Franchise outlet not found");
    }

    franchise.location = {
      type: "Point",
      coordinates: [lng, lat],
    };
    franchise.isLocationVerified = true;
    await franchise.save();

    return franchise;
  }

  /**
   * Find nearest eligible outlets using MongoDB 2dsphere proximity search
   * Optionally verifies stock availability for requested items
   */
  async findNearestOutlets({ longitude, latitude, radiusKm = null, items = null }) {
    const lng = Number(longitude);
    const lat = Number(latitude);

    if (isNaN(lng) || isNaN(lat)) {
      throw new Error("Valid longitude and latitude coordinates are required");
    }

    // Determine search radius (query param -> StoreSettings -> default 15km)
    let searchRadius = radiusKm ? Number(radiusKm) : null;
    if (!searchRadius) {
      const settings = await StoreSettings.findOne().lean();
      searchRadius = settings?.defaultRadiusKm || 15;
    }

    const maxDistanceMeters = searchRadius * 1000;

    // 2dsphere $near query
    const nearbyOutlets = await Franchise.find({
      status: "active",
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
          $maxDistance: maxDistanceMeters,
        },
      },
    }).lean();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return nearbyOutlets;
    }

    // Filter outlets by stock availability
    const eligibleOutlets = [];
    for (const outlet of nearbyOutlets) {
      const hasStock = await this.checkOutletStock(outlet._id, items);
      if (hasStock.isAvailable) {
        eligibleOutlets.push({
          ...outlet,
          stockVerified: true,
        });
      }
    }

    return eligibleOutlets;
  }

  /**
   * Check if an outlet has stock for all requested items
   */
  async checkOutletStock(franchiseId, items) {
    const unavailableItems = [];

    for (const item of items) {
      const productId = item.productId || item.product;
      const variantSku = item.variant_sku || null;
      const requestedQty = Number(item.quantity || 1);

      const query = {
        franchise: franchiseId,
        product: productId,
      };
      if (variantSku) {
        query.variant_sku = variantSku;
      }

      const inv = await FranchiseInventory.findOne(query).lean();
      const availableQty = inv
        ? Math.max(0, (inv.quantity_on_hand || 0) - (inv.reserved_quantity || 0))
        : 0;

      if (availableQty < requestedQty) {
        unavailableItems.push({
          productId,
          variantSku,
          requestedQuantity: requestedQty,
          availableQuantity: availableQty,
        });
      }
    }

    return {
      isAvailable: unavailableItems.length === 0,
      unavailableItems,
    };
  }

  /**
   * Get outlet by QR code or QR token (locked outlet flow)
   */
  async getByQrToken(token) {
    if (!token) throw new Error("QR token is required");
    const outlet = await Franchise.findOne({
      $or: [{ qrToken: token }, { code: token.toUpperCase() }],
      status: "active",
    });

    if (!outlet) {
      throw new Error("Active outlet not found for this QR code");
    }
    return outlet;
  }

  /**
   * Regenerate QR code for a franchise
   */
  async regenerateQr(franchiseId) {
    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) throw new Error("Franchise not found");

    franchise.qrToken = null; // force new token
    await this.generateQrForFranchise(franchise);
    await franchise.save();
    return franchise;
  }
}

module.exports = new FranchiseService();
