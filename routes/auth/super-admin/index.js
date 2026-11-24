const express = require("express");
const {
  getAllSuperAdmins,
  createSuperAdmin,
  updateSuperAdmin,
  deleteSuperAdmin,
  getSingleSuperAdmin,
} = require("../../../controllers/auth/super-admin/index");
const { superAdmin } = require("../../../middleware/auth/adminMiddleware");

const router = express.Router();

// Apply superAdmin middleware to all routes
router.use(superAdmin);

router.get("/get-admin/:id", getSingleSuperAdmin);
router.get("/:id", getSingleSuperAdmin);

router.patch("/update/:id", updateSuperAdmin);
router.patch("/:id", updateSuperAdmin);
router.put("/:id", updateSuperAdmin);

router.delete("/delete/:id", deleteSuperAdmin);
router.delete("/:id", deleteSuperAdmin);

router.get("/get-all", getAllSuperAdmins);
router.get("/", getAllSuperAdmins);

router.post("/register", createSuperAdmin);
router.post("/", createSuperAdmin);

module.exports = router;
