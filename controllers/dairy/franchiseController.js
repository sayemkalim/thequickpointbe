const { asyncHandler } = require("../../common/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const FranchiseService = require("../../services/franchise/index");
const Franchise = require("../../models/franchiseModel");

/**
 * Public: Find nearest active outlets by location coordinates
 */
const getNearbyOutlets = asyncHandler(async (req, res) => {
  const { longitude, latitude, radiusKm, items } = req.query;

  if (!longitude || !latitude) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Longitude and latitude query parameters are required", false));
  }

  let parsedItems = null;
  if (items) {
    try {
      parsedItems = typeof items === "string" ? JSON.parse(items) : items;
    } catch (e) {
      // Ignored if invalid json
    }
  }

  const outlets = await FranchiseService.findNearestOutlets({
    longitude: Number(longitude),
    latitude: Number(latitude),
    radiusKm: radiusKm ? Number(radiusKm) : null,
    items: parsedItems,
  });

  return res.status(200).json(
    new ApiResponse(200, outlets, `Found ${outlets.length} eligible outlets nearby.`, true)
  );
});

/**
 * Public: Scan Outlet QR Code (Locked Outlet flow)
 * Returns outlet details and marks flow as locked to this outlet
 */
const scanOutletQr = asyncHandler(async (req, res) => {
  const { token } = req.params;

  try {
    const outlet = await FranchiseService.getByQrToken(token);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          outlet,
          isQrLocked: true,
          pickupAddress: outlet.address,
        },
        `Connected to ${outlet.name}. Outlet selection locked.`,
        true
      )
    );
  } catch (error) {
    return res.status(404).json(new ApiResponse(404, null, error.message, false));
  }
});

/**
 * Public: List all active outlets
 */
const listOutlets = asyncHandler(async (req, res) => {
  const outlets = await Franchise.find({ status: "active" })
    .select("-ownerAdmin")
    .sort({ name: 1 })
    .lean();

  return res.status(200).json(
    new ApiResponse(200, outlets, "Outlets fetched successfully", true)
  );
});

/**
 * Public: Get single outlet by ID
 */
const getOutletById = asyncHandler(async (req, res) => {
  const outlet = await Franchise.findById(req.params.id).lean();
  if (!outlet) {
    return res.status(404).json(new ApiResponse(404, null, "Outlet not found", false));
  }
  return res.status(200).json(new ApiResponse(200, outlet, "Outlet details fetched", true));
});

/**
 * Admin: Create new franchise outlet
 */
const createFranchise = asyncHandler(async (req, res) => {
  try {
    const franchise = await FranchiseService.createFranchise(req.body);
    return res.status(201).json(
      new ApiResponse(201, franchise, "Franchise outlet created successfully", true)
    );
  } catch (error) {
    return res.status(400).json(new ApiResponse(400, null, error.message, false));
  }
});

/**
 * Admin: Update franchise outlet
 */
const updateFranchise = asyncHandler(async (req, res) => {
  try {
    const franchise = await FranchiseService.updateFranchise(
      req.params.id,
      req.body,
      req.admin._id
    );
    return res.status(200).json(
      new ApiResponse(200, franchise, "Franchise outlet updated successfully", true)
    );
  } catch (error) {
    return res.status(400).json(new ApiResponse(400, null, error.message, false));
  }
});

/**
 * Admin: Regenerate QR Code for outlet
 */
const regenerateQrCode = asyncHandler(async (req, res) => {
  try {
    const franchise = await FranchiseService.regenerateQr(req.params.id);
    return res.status(200).json(
      new ApiResponse(200, franchise, "QR code regenerated successfully", true)
    );
  } catch (error) {
    return res.status(400).json(new ApiResponse(400, null, error.message, false));
  }
});

module.exports = {
  getNearbyOutlets,
  scanOutletQr,
  listOutlets,
  getOutletById,
  createFranchise,
  updateFranchise,
  regenerateQrCode,
};
