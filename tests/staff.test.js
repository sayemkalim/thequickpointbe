const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Admin = require("../models/adminModel");
const Franchise = require("../models/franchiseModel");

describe("Admin & Franchise Owner Staff Management", () => {
  let mongoServer;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  test("1. Franchise owner is created and linked to franchise outlet", async () => {
    const outlet = await Franchise.create({
      name: "Patna Central Outlet",
      code: "QP-PATNA-001",
      outletCode: "QP-PATNA-001",
      phone: "9876543210",
      email: "outlet@quickpoint.in",
      location: { type: "Point", coordinates: [85.1376, 25.5941] },
      address: { street: "Main Road", city: "Patna", district: "Patna", state: "Bihar", pincode: "800001" },
    });

    const franchiseOwner = await Admin.create({
      name: "Kaif Manager",
      email: "kaif@quickpoint.in",
      password: "password123",
      role: "franchise_owner",
      franchise: outlet._id,
    });

    assert.strictEqual(franchiseOwner.role, "franchise_owner");
    assert.strictEqual(String(franchiseOwner.franchise), String(outlet._id));
  });

  test("2. Staff query returns all roles (admin, franchise_owner) and populates franchise details", async () => {
    const centralAdmin = await Admin.create({
      name: "Operations Admin",
      email: "ops@quickpoint.in",
      password: "password123",
      role: "admin",
    });

    // Query all staff (role in ["admin", "franchise_owner", "sub_admin", "super_admin"])
    const query = { role: { $in: ["admin", "franchise_owner", "sub_admin", "super_admin"] } };
    const allStaff = await Admin.find(query)
      .populate("franchise", "name code city")
      .select("-password")
      .sort({ createdAt: -1 });

    assert.strictEqual(allStaff.length >= 2, true);

    const fo = allStaff.find((s) => s.role === "franchise_owner");
    assert.ok(fo);
    assert.strictEqual(fo.name, "Kaif Manager");
    assert.strictEqual(fo.franchise.name, "Patna Central Outlet");
    assert.strictEqual(fo.franchise.code, "QP-PATNA-001");

    const ca = allStaff.find((s) => s.role === "admin");
    assert.ok(ca);
    assert.strictEqual(ca.name, "Operations Admin");
  });

  test("3. Role filtering returns only designated role", async () => {
    const franchiseOnly = await Admin.find({ role: "franchise_owner" }).select("-password");
    assert.strictEqual(franchiseOnly.length, 1);
    assert.strictEqual(franchiseOnly[0].email, "kaif@quickpoint.in");

    const adminOnly = await Admin.find({ role: "admin" }).select("-password");
    assert.strictEqual(adminOnly.length, 1);
    assert.strictEqual(adminOnly[0].email, "ops@quickpoint.in");
  });
});
