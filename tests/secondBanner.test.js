const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const SecondBanner = require("../models/secondBannerModel.js");
const Product = require("../models/productsModel.js");
const SecondBannerService = require("../services/secondBanner/index.js");

let mongoServer;

describe("Top Single Banner (SecondBanner) Test Suite", () => {
  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  test("1. Create top single banner successfully", async () => {
    const product = await Product.create({
      name: "Fresh Matka Dahi",
      sku: "QP-DAHI-01",
      price: 60,
      inventory: 50,
      created_by_admin: new mongoose.Types.ObjectId(),
    });

    const createResult = await SecondBannerService.createBanner({
      banner_url: "https://res.cloudinary.com/test/image/upload/v1/banner.png",
      title: "Kulhad Dahi Special",
      product: product._id,
      link: "/product/fresh-matka-dahi",
      order: 0,
      is_active: true,
    });

    assert.equal(createResult.success, true);
    assert.ok(createResult.banner._id);
    assert.equal(createResult.banner.banner_url, "https://res.cloudinary.com/test/image/upload/v1/banner.png");
    assert.equal(createResult.banner.banner_image, "https://res.cloudinary.com/test/image/upload/v1/banner.png");
    assert.equal(createResult.banner.title, "Kulhad Dahi Special");
    assert.equal(createResult.banner.is_active, true);
    assert.equal(createResult.banner.product._id.toString(), product._id.toString());
  });

  test("2. Fetch active banner and all banners list", async () => {
    const active = await SecondBannerService.getActiveBanner();
    assert.ok(active);
    assert.equal(active.title, "Kulhad Dahi Special");

    const all = await SecondBannerService.getAllBanners({ page: 1, per_page: 10 });
    assert.equal(all.total, 1);
    assert.equal(all.banners.length, 1);
  });

  test("3. Update banner details and toggle status", async () => {
    const active = await SecondBannerService.getActiveBanner();
    const updateResult = await SecondBannerService.updateBanner(active._id, {
      title: "Updated Kulhad Dahi Special",
      is_active: false,
    });

    assert.equal(updateResult.success, true);
    assert.equal(updateResult.banner.title, "Updated Kulhad Dahi Special");
    assert.equal(updateResult.banner.is_active, false);

    // Active banner should now be null since is_active is false
    const activeAfter = await SecondBannerService.getActiveBanner();
    assert.equal(activeAfter, null);
  });

  test("4. Delete banner", async () => {
    const all = await SecondBannerService.getAllBanners({ page: 1, per_page: 10 });
    const bannerId = all.banners[0]._id;

    const deleted = await SecondBannerService.deleteBanner(bannerId);
    assert.ok(deleted);

    const allAfter = await SecondBannerService.getAllBanners({ page: 1, per_page: 10 });
    assert.equal(allAfter.total, 0);
  });
});
