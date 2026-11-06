const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const franchiseRoutes = require("../routes/dairy/franchiseRoutes");
const FranchiseService = require("../services/franchise/index");
const { updateFranchise, deleteFranchise } = require("../controllers/dairy/franchiseController");

describe("Franchise Outlet Update & Delete Route & Service Architecture", () => {
  test("1. franchiseRoutes exposes PUT, PATCH, and DELETE methods on /:id", () => {
    // Inspect Express router layer stack
    const routes = franchiseRoutes.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
      }));

    const updatePatch = routes.find((r) => r.path === "/:id" && r.methods.includes("patch"));
    const updatePut = routes.find((r) => r.path === "/:id" && r.methods.includes("put"));
    const deleteRoute = routes.find((r) => r.path === "/:id" && r.methods.includes("delete"));

    assert.ok(updatePatch, "PATCH /api/dairy/outlets/:id must be mounted");
    assert.ok(updatePut, "PUT /api/dairy/outlets/:id must be mounted");
    assert.ok(deleteRoute, "DELETE /api/dairy/outlets/:id must be mounted");
  });

  test("2. FranchiseService has updateFranchise and deleteFranchise methods", () => {
    assert.equal(typeof FranchiseService.updateFranchise, "function");
    assert.equal(typeof FranchiseService.deleteFranchise, "function");
  });

  test("3. Franchise controller exports updateFranchise and deleteFranchise handlers", () => {
    assert.equal(typeof updateFranchise, "function");
    assert.equal(typeof deleteFranchise, "function");
  });
});

