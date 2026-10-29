const jwt = require("jsonwebtoken");
const Admin = require("../../models/adminModel");
const ApiResponse = require("../../utils/ApiResponse");

const authenticateRole =
  (allowedRoles = []) =>
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.split(" ")[1];

      if (!token) {
        return res
          .status(401)
          .json(new ApiResponse(401, null, "Unauthorized", false));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const admin = await Admin.findById(decoded.id).select("-password");

      if (!admin || !allowedRoles.includes(admin.role)) {
        return res
          .status(403)
          .json(new ApiResponse(403, null, "Access denied", false));
      }

      req.admin = admin;
      next();
    } catch (error) {
      res
        .status(403)
        .json(new ApiResponse(403, null, "Invalid or expired token", false));
    }
  };

// Role-based authentication middlewares
module.exports = {
  superAdmin: authenticateRole(["super_admin"]),
  admin: authenticateRole(["admin"]),
  subAdmin: authenticateRole(["sub_admin"]),
  adminOrSubAdmin: authenticateRole(["admin", "sub_admin"]),
  adminOrSuperAdmin: authenticateRole(["admin", "super_admin"]),
  adminOrSubAdminOrSuperAdmin: authenticateRole([
    "admin",
    "sub_admin",
    "super_admin",
  ]),
  // Dairy Platform RBAC
  centralAdmin: authenticateRole(["super_admin", "admin"]),
  franchiseOwner: authenticateRole(["franchise_owner"]),
  franchiseOrAdmin: authenticateRole(["super_admin", "admin", "franchise_owner"]),
  
  // Guard ensuring franchise owners can ONLY access their own outlet's resources
  scopeToFranchise: (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json(new ApiResponse(401, null, "Authentication required", false));
    }
    const isCentral = ["super_admin", "admin"].includes(req.admin.role);
    if (req.admin.role === "franchise_owner") {
      if (!req.admin.franchise) {
        return res.status(403).json(new ApiResponse(403, null, "No franchise assigned to this owner account", false));
      }
      const targetFranchise = req.params.franchiseId || req.body.franchiseId || req.query.franchiseId || req.body.franchise;
      if (targetFranchise && String(targetFranchise) !== String(req.admin.franchise)) {
        return res.status(403).json(new ApiResponse(403, null, "Unauthorized: You can only access your assigned franchise outlet.", false));
      }
      req.scopedFranchiseId = req.admin.franchise;
    } else if (isCentral) {
      req.scopedFranchiseId = req.params.franchiseId || req.body.franchiseId || req.query.franchiseId || req.body.franchise || null;
    }
    next();
  },
};
