const express = require("express");
const {
  getAllAdmins,
  registerAdmin,
  updateAdmin,
  deleteAdmin,
  loginAdmin,
  forgotPassword,
  getAllSubAdmins,
  registerSubAdmin,
  getSingleAdmin,
} = require("../../../controllers/auth/admin/index");
const {
  centralAdmin,
} = require("../../../middleware/auth/adminMiddleware");

const router = express.Router();

router.get("/", centralAdmin, getAllAdmins);
router.post("/register", centralAdmin, registerAdmin);
router.post("/login", loginAdmin);
router.post("/forgot-password", forgotPassword);
router.get("/sub-admin", centralAdmin, getAllSubAdmins);
router.post("/sub-admin", centralAdmin, registerSubAdmin);
router.get("/:id", centralAdmin, getSingleAdmin);

// Operational & Staff Management APIs
router.patch("/edit/:id", centralAdmin, updateAdmin);
router.delete("/delete/:id", centralAdmin, deleteAdmin);

module.exports = router;
