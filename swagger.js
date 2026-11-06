const swaggerJSDoc = require("swagger-jsdoc");

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "QuickPoint Backend API",
    version: "1.0.0",
    description: `
# QuickPoint Multi-Outlet Dairy E-Commerce Platform API

Backend services for QuickPoint Dairy in Bihar:
- **Customer Mobile OTP Authentication** (WebzMedia Token Key SMS API)
- **Multi-Outlet Discovery & GeoJSON Proximity Search**
- **Outlet QR-Code Ordering & Tokens**
- **Real-Time Atomic Stock Reservations**
- **100% Pickup-Only Fulfillment with 6-Digit Pickup OTP**
- **Immutable Franchise Commission Ledgers**
- **Online Payments via Razorpay & Cashfree**
- **Shiprocket Courier Integration**
    `,
    contact: {
      name: "QuickPoint Support",
      email: "support@quickpoint.in",
      url: "https://thequickpoint.in",
    },
  },
  servers: [
    {
      url: "http://localhost:5000",
      description: "Local Development Server",
    },
    {
      url: "https://thequickpointbe-3opb.onrender.com",
      description: "Production Server (Render)",
    },
  ],
  tags: [
    { name: "Customer Authentication", description: "Customer Mobile OTP (WebzMedia SMS) & Google OAuth" },
    { name: "Multi-Outlet Dairy Discovery", description: "GeoJSON proximity searches, outlet profiles & QR code tokens" },
    { name: "Dairy Orders & Pickup Verification", description: "Atomic inventory checkout, payment verification & pickup OTP" },
    { name: "Outlet Inventory & Restocking", description: "Outlet-level physical, reserved, and available dairy stock" },
    { name: "Store Settings & Commission Ledger", description: "Commission policies, audit logs & immutable franchise accounting" },
    { name: "Products & Dairy Catalog", description: "Dairy catalog (milk, curd, paneer, ghee) & product management" },
    { name: "Shopping Cart", description: "Customer cart operations" },
    { name: "Webhooks", description: "Cryptographically verified Razorpay, Cashfree & Shiprocket webhooks" },
    { name: "Marquee Announcements", description: "Storefront scrolling banner notices" },
    { name: "Admin Dashboard", description: "Sales analytics, KPIs and category breakdown" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT access token returned after Mobile OTP verification or Admin Login.",
      },
      shiprocketWebhookToken: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
      },
    },
    schemas: {
      ApiResponse: {
        type: "object",
        properties: {
          statusCode: { type: "integer", example: 200 },
          success: { type: "boolean", example: true },
          message: { type: "string", example: "Operation successful" },
          data: { type: "object" },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          statusCode: { type: "integer", example: 400 },
          success: { type: "boolean", example: false },
          message: { type: "string", example: "Error message details" },
        },
      },
      SendOtpRequest: {
        type: "object",
        required: ["phoneNumber"],
        properties: {
          phoneNumber: { type: "string", example: "9876543210", description: "10-digit Indian mobile number" },
        },
      },
      VerifyOtpRequest: {
        type: "object",
        required: ["phoneNumber", "otp"],
        properties: {
          phoneNumber: { type: "string", example: "9876543210" },
          otp: { type: "string", example: "123456", description: "6-digit OTP received via SMS" },
          name: { type: "string", example: "Aman Kumar" },
        },
      },
      OutletCheckoutRequest: {
        type: "object",
        required: ["franchiseId", "items"],
        properties: {
          franchiseId: { type: "string", example: "673f8a12bc901a0012345678" },
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["productId", "quantity"],
              properties: {
                productId: { type: "string", example: "673e1c98af0012bc34567890" },
                variantSku: { type: "string", example: "base" },
                quantity: { type: "integer", example: 2 },
              },
            },
          },
          paymentGateway: { type: "string", enum: ["razorpay", "cashfree"], example: "razorpay" },
        },
      },
      VerifyPaymentRequest: {
        type: "object",
        required: ["orderId"],
        properties: {
          orderId: { type: "string", example: "6740b129cd88710012345678" },
          razorpay_payment_id: { type: "string", example: "pay_RZP987654321" },
          razorpay_order_id: { type: "string", example: "order_RZP123456789" },
          razorpay_signature: { type: "string", example: "9a0f4b82d3e5f7a1..." },
        },
      },
      VerifyPickupOtpRequest: {
        type: "object",
        required: ["orderId", "pickupOtp"],
        properties: {
          orderId: { type: "string", example: "6740b129cd88710012345678" },
          pickupOtp: { type: "string", example: "482910", description: "6-digit pickup verification OTP" },
        },
      },
      RestockRequest: {
        type: "object",
        required: ["franchiseId", "productId", "quantity"],
        properties: {
          franchiseId: { type: "string", example: "673f8a12bc901a0012345678" },
          productId: { type: "string", example: "673e1c98af0012bc34567890" },
          variantSku: { type: "string", example: "base" },
          quantity: { type: "integer", example: 50 },
        },
      },
    },
  },
  paths: {
    "/api/auth/user/send-otp": {
      post: {
        tags: ["Customer Authentication"],
        summary: "Send 6-digit Mobile OTP via WebzMedia SMS",
        description: "Delivers DLT-approved OTP message to customer mobile. Rate limited to 3 requests per 10 minutes.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/SendOtpRequest" } } },
        },
        responses: {
          200: { description: "OTP sent successfully", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiResponse" } } } },
          400: { description: "Invalid phone number" },
          429: { description: "Rate limit exceeded" },
        },
      },
    },
    "/api/auth/user/verify-otp": {
      post: {
        tags: ["Customer Authentication"],
        summary: "Verify Mobile OTP and Login/Register Customer",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/VerifyOtpRequest" } } },
        },
        responses: {
          200: { description: "User verified; returns JWT access token", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiResponse" } } } },
          400: { description: "Invalid or expired OTP" },
        },
      },
    },
    "/api/dairy/outlets": {
      get: {
        tags: ["Multi-Outlet Dairy Discovery"],
        summary: "List All Dairy Outlets",
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "inactive"] } },
          { name: "search", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "Array of dairy outlets" } },
      },
      post: {
        tags: ["Multi-Outlet Dairy Discovery"],
        summary: "Create New Dairy Outlet",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "code", "phone"],
                properties: {
                  name: { type: "string", example: "QuickPoint Kankarbagh Outlet" },
                  code: { type: "string", example: "QP-PATNA-001" },
                  phone: { type: "string", example: "9876543210" },
                  email: { type: "string", example: "kankarbagh@quickpoint.in" },
                  latitude: { type: "number", example: 25.5941, description: "Optional: Store latitude. Can be set later by outlet manager via GPS." },
                  longitude: { type: "number", example: 85.1376, description: "Optional: Store longitude. Can be set later by outlet manager via GPS." },
                  radiusKm: { type: "number", default: 15 },
                  address: {
                    type: "object",
                    properties: {
                      street: { type: "string" },
                      locality: { type: "string" },
                      city: { type: "string", default: "Patna" },
                      state: { type: "string", default: "Bihar" },
                      pincode: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { 201: { description: "Franchise outlet created with unique QR code" } },
      },
    },
    "/api/dairy/outlets/{id}": {
      get: {
        tags: ["Multi-Outlet Dairy Discovery"],
        summary: "Get Franchise Outlet Details by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Outlet profile, coordinates, operating hours, and QR tokens" } },
      },
      patch: {
        tags: ["Multi-Outlet Dairy Discovery"],
        summary: "Update Franchise Outlet",
        description: "Updates outlet details, location coordinates, operating hours, or status (active/inactive).",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  phone: { type: "string" },
                  email: { type: "string" },
                  status: { type: "string", enum: ["active", "inactive", "temporary_closed"] },
                  latitude: { type: "number" },
                  longitude: { type: "number" },
                  radiusKm: { type: "number" },
                  address: { type: "object" },
                  operatingHours: { type: "object" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Outlet updated successfully" } },
      },
      delete: {
        tags: ["Multi-Outlet Dairy Discovery"],
        summary: "Delete or Deactivate Franchise Outlet",
        description: "Soft-deletes (deactivates) the outlet by default. Add ?hard=true for permanent deletion.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "hard", in: "query", schema: { type: "boolean", default: false }, description: "Set true to permanently delete from database" },
        ],
        responses: {
          200: { description: "Outlet deactivated or permanently deleted successfully" },
          404: { description: "Outlet not found" },
        },
      },
    },
    "/api/dairy/outlets/{id}/location": {
      patch: {
        tags: ["Multi-Outlet Dairy Discovery"],
        summary: "Set Outlet GPS Coordinates from Physical Store",
        description: "Enables Franchise Owner (or Admin) to click 'Use Current Location' from the physical shop and lock high-precision GPS coordinates.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["latitude", "longitude"],
                properties: {
                  latitude: { type: "number", example: 25.5941, description: "Exact store latitude from device GPS" },
                  longitude: { type: "number", example: 85.1376, description: "Exact store longitude from device GPS" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Store GPS coordinates set and marked verified" },
          403: { description: "Unauthorized: Outlet owner can only set coordinates for their own outlet" },
          404: { description: "Outlet not found" },
        },
      },
    },
    "/api/dairy/outlets/nearby": {
      get: {
        tags: ["Multi-Outlet Dairy Discovery"],
        summary: "Find Nearest Dairy Outlets (Proximity Search)",
        parameters: [
          { name: "latitude", in: "query", required: true, schema: { type: "number", example: 25.5941 } },
          { name: "longitude", in: "query", required: true, schema: { type: "number", example: 85.1376 } },
          { name: "radiusKm", in: "query", schema: { type: "number", default: 15 } },
        ],
        responses: { 200: { description: "Nearby outlets sorted by proximity in KM" } },
      },
    },
    "/api/dairy/outlets/qr/{token}": {
      get: {
        tags: ["Multi-Outlet Dairy Discovery"],
        summary: "Resolve Outlet Profile via QR Code Token",
        parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Outlet details and catalog" }, 404: { description: "QR code not found" } },
      },
    },
    "/api/dairy/orders/checkout": {
      post: {
        tags: ["Dairy Orders & Pickup Verification"],
        summary: "Create Dairy Pickup Order (Atomic Stock Reservation)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/OutletCheckoutRequest" } } },
        },
        responses: { 201: { description: "Order created with gateway payment details" } },
      },
    },
    "/api/dairy/orders/verify-payment": {
      post: {
        tags: ["Dairy Orders & Pickup Verification"],
        summary: "Verify Payment & Generate 6-Digit Pickup OTP",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/VerifyPaymentRequest" } } },
        },
        responses: { 200: { description: "Payment verified; SMS OTP sent for pickup" } },
      },
    },
    "/api/dairy/orders/pickup/verify": {
      post: {
        tags: ["Dairy Orders & Pickup Verification"],
        summary: "Verify Pickup OTP at Outlet (Staff Finalization)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/VerifyPickupOtpRequest" } } },
        },
        responses: { 200: { description: "Order marked delivered/picked_up" } },
      },
    },
    "/api/dairy/inventory/{franchiseId}": {
      get: {
        tags: ["Outlet Inventory & Restocking"],
        summary: "Get Outlet Dairy Inventory Levels",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "franchiseId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Physical, reserved, and available stock levels" } },
      },
    },
    "/api/dairy/inventory/restock": {
      post: {
        tags: ["Outlet Inventory & Restocking"],
        summary: "Restock Dairy Products at Outlet",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RestockRequest" } } },
        },
        responses: { 200: { description: "Inventory restocked successfully" } },
      },
    },
    "/api/product": {
      get: {
        tags: ["Products & Dairy Catalog"],
        summary: "Browse Dairy & Store Catalog",
        parameters: [
          { name: "isDairy", in: "query", schema: { type: "boolean" } },
          { name: "dairyCategory", in: "query", schema: { type: "string", enum: ["milk", "curd", "paneer", "ghee", "butter", "sweets"] } },
          { name: "search", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "List of products" } },
      },
    },
    "/api/cart": {
      get: {
        tags: ["Shopping Cart"],
        summary: "Get Current Cart",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Active cart items" } },
      },
    },
    "/api/marquee/active": {
      get: {
        tags: ["Marquee Announcements"],
        summary: "Active Storefront Scrolling Announcements",
        responses: { 200: { description: "Active marquee items" } },
      },
    },
    "/api/dashboard/overview": {
      get: {
        tags: ["Admin Dashboard"],
        summary: "Get Platform KPIs",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Total revenue, orders, active outlets" } },
      },
    },
  },
};

const options = {
  swaggerDefinition,
  apis: ["./routes/**/*.js"],
};

const swaggerSpec = swaggerJSDoc(options);
module.exports = swaggerSpec;
