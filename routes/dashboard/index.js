const express = require("express");
const router = express.Router();
const DashboardController = require("../../controllers/dashboard/index");
const {
  franchiseOrAdmin,
} = require("../../middleware/auth/adminMiddleware");

// Dashboard Cards API
router.get("/overview", franchiseOrAdmin, DashboardController.getDashboardCards);

// Sales Overview API (Bar Chart)
router.get("/sales-overview", franchiseOrAdmin, DashboardController.getSalesOverview);

// Monthly Growth API (Line Chart)
router.get("/monthly-growth", franchiseOrAdmin, DashboardController.getMonthlyGrowth);

// Category Distribution API (Pie Chart)
router.get("/category-distribution", franchiseOrAdmin, DashboardController.getCategoryDistribution);

// Revenue Trend API (Line Chart)
router.get("/revenue-trend", franchiseOrAdmin, DashboardController.getRevenueTrend);

module.exports = router; 