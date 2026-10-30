# QuickPoint Backend — Complete API Reference Manual

> **Base URL (Local):** `http://localhost:5000`  
> **Interactive Swagger Documentation:** `http://localhost:5000/api-doc`  
> **Protocol:** JSON over HTTP/1.1 or HTTP/2  
> **Fulfillment Model:** 100% Pickup-only dairy outlet model with Courier Shipping via Shiprocket.

---

## Table of Contents
1. [Authentication & Authorization](#1-authentication--authorization)
2. [Multi-Outlet Dairy Platform APIs](#2-multi-outlet-dairy-platform-apis)
   - [2.1 Outlet Management & Discovery](#21-outlet-management--discovery)
   - [2.2 Outlet Inventory & Restocking](#22-outlet-inventory--restocking)
   - [2.3 Dairy Orders & Pickup Verification](#23-dairy-orders--pickup-verification)
   - [2.4 Store Settings & Franchise Commission Ledger](#24-store-settings--franchise-commission-ledger)
3. [Shiprocket Shipping & Courier APIs](#3-shiprocket-shipping--courier-apis)
4. [Customer Authentication & Account APIs](#4-customer-authentication--account-apis)
5. [Admin & Franchise Staff Management](#5-admin--franchise-staff-management)
6. [Products & Dairy Catalog APIs](#6-products--dairy-catalog-apis)
7. [Categories & Sub-Categories](#7-categories--sub-categories)
8. [Shopping Cart APIs](#8-shopping-cart-apis)
9. [Standard Orders & Payments](#9-standard-orders--payments)
10. [Webhooks (Razorpay, Cashfree, Shiprocket)](#10-webhooks-razorpay-cashfree-shiprocket)
11. [Central Inventory & Warehouse](#11-central-inventory--warehouse)
12. [Coupons & Promotional Banners](#12-coupons--promotional-banners)
13. [Customer Addresses & Reviews](#13-customer-addresses--reviews)
14. [Admin Dashboard & Analytics](#14-admin-dashboard--analytics)
15. [Blogs & Contact Us](#15-blogs--contact-us)

---

## 1. Authentication & Authorization

Protected endpoints require a JSON Web Token (JWT) passed in the `Authorization` request header:
```http
Authorization: Bearer <jwt_access_token>
```

### Roles
| Role | Description | Access Scope |
| :--- | :--- | :--- |
| `user` | Customer authenticated via Mobile OTP or PIN | Can browse catalog, manage personal cart, place orders, view order history. |
| `super_admin` | Platform owner / Central Admin | Unrestricted access across all outlets, system settings, payouts, and catalogs. |
| `admin` | Central Operations Staff | Global access to orders, products, inventory, and analytics. |
| `franchise_owner` | Outlet Owner or Store Manager | Scoped strictly to their designated `franchise` outlet (`orders`, `inventory`, `commission`). |

---

## 2. Multi-Outlet Dairy Platform APIs

### 2.1 Outlet Management & Discovery

#### Find Nearest Outlets (Proximity Search)
- **Method & Path:** `GET /api/dairy/outlets/nearby`
- **Auth:** Public
- **Query Parameters:**
  - `latitude` (Number, required): Customer latitude (e.g. `25.5941`)
  - `longitude` (Number, required): Customer longitude (e.g. `85.1376`)
  - `radius` (Number, optional): Search radius in KM (Default: `15`)
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "count": 1,
    "data": [
      {
        "_id": "673f8a...",
        "name": "QuickPoint Kankarbagh Outlet",
        "outletCode": "QP-PATNA-001",
        "address": {
          "street": "Main Road, Kankarbagh",
          "city": "Patna",
          "district": "Patna",
          "state": "Bihar",
          "pincode": "800020"
        },
        "location": {
          "type": "Point",
          "coordinates": [85.1376, 25.5941]
        },
        "distanceKm": 1.25,
        "operatingHours": { "open": "06:00", "close": "22:00" },
        "isActive": true
      }
    ]
  }
  ```

#### Resolve Outlet by QR Code Token
- **Method & Path:** `GET /api/dairy/outlets/qr/:token`
- **Auth:** Public
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "outlet": {
        "_id": "673f8a...",
        "name": "QuickPoint Kankarbagh Outlet",
        "qrToken": "a8f192...",
        "qrCodeUrl": "data:image/png;base64,..."
      }
    }
  }
  ```

#### List All Outlets
- **Method & Path:** `GET /api/dairy/outlets`
- **Auth:** Public / Optional User
- **Query Parameters:** `district`, `city`, `isActive`, `search`

#### Create Outlet
- **Method & Path:** `POST /api/dairy/outlets`
- **Auth:** Central Admin (`super_admin`, `admin`)
- **Request Body:**
  ```json
  {
    "name": "QuickPoint Boring Road Outlet",
    "owner": {
      "name": "Ramesh Kumar",
      "email": "ramesh@quickpoint.in",
      "phone": "9876543210"
    },
    "address": {
      "street": "Boring Canal Road",
      "city": "Patna",
      "district": "Patna",
      "state": "Bihar",
      "pincode": "800001"
    },
    "location": {
      "latitude": 25.6132,
      "longitude": 85.1215
    },
    "operatingHours": {
      "open": "06:00",
      "close": "22:00"
    }
  }
  ```

#### Regenerate Outlet QR Code
- **Method & Path:** `POST /api/dairy/outlets/:id/regenerate-qr`
- **Auth:** Central Admin

---

### 2.2 Outlet Inventory & Restocking

#### Get Outlet Inventory
- **Method & Path:** `GET /api/dairy/inventory/:franchiseId`
- **Auth:** Admin or Assigned `franchise_owner`
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": [
      {
        "_id": "673f...",
        "product": {
          "_id": "673e...",
          "name": "Fresh Cow Milk 1L",
          "dairyCategory": "milk",
          "unit": "L",
          "price": 60
        },
        "physicalStock": 100,
        "reservedStock": 5,
        "availableStock": 95,
        "lowStockThreshold": 15
      }
    ]
  }
  ```

#### Restock Physical Inventory at Outlet
- **Method & Path:** `POST /api/dairy/inventory/restock`
- **Auth:** Admin or Assigned `franchise_owner`
- **Request Body:**
  ```json
  {
    "franchiseId": "673f8a...",
    "productId": "673e1c...",
    "variantSku": "base",
    "quantity": 50,
    "batchNumber": "BATCH-2026-10-30",
    "expiryDate": "2026-11-03T00:00:00.000Z"
  }
  ```

---

### 2.3 Dairy Orders & Pickup Verification

#### Place Dairy Pickup Order (Atomic Reservation & Commission Snapshot)
- **Method & Path:** `POST /api/dairy/orders/checkout`
- **Auth:** Authenticated User (`user`)
- **Request Body:**
  ```json
  {
    "franchiseId": "673f8a...",
    "items": [
      {
        "productId": "673e1c...",
        "variantSku": "base",
        "quantity": 2
      }
    ],
    "paymentGateway": "razorpay"
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "success": true,
    "message": "Dairy pickup order created. Complete payment to finalize.",
    "data": {
      "order": {
        "_id": "6740b...",
        "orderNumber": 10001,
        "fulfillmentType": "pickup",
        "pickupStatus": "ready_for_pickup",
        "totalAmount": 120,
        "paymentStatus": "pending"
      },
      "gatewayOrder": {
        "id": "order_RZP123456",
        "amount": 12000,
        "currency": "INR"
      }
    }
  }
  ```

#### Verify Payment & Finalize Pickup Order
- **Method & Path:** `POST /api/dairy/orders/verify-payment`
- **Auth:** Authenticated User (`user`)
- **Request Body:**
  ```json
  {
    "orderId": "6740b...",
    "razorpay_payment_id": "pay_RZP987654",
    "razorpay_order_id": "order_RZP123456",
    "razorpay_signature": "signature_hash..."
  }
  ```
- **Response `200 OK`:** Returns confirmed order with **generated 6-digit `pickupOtp`** (e.g. `"482910"`).

#### Verify Pickup OTP at Outlet (Staff Pickup Finalization)
- **Method & Path:** `POST /api/dairy/orders/pickup/verify`
- **Auth:** Admin or Assigned `franchise_owner` (Store Staff)
- **Request Body:**
  ```json
  {
    "orderId": "6740b...",
    "pickupOtp": "482910"
  }
  ```
- **Response `200 OK`:** Order marked `picked_up` with atomic double-pickup prevention.

---

### 2.4 Store Settings & Franchise Commission Ledger

#### Get Store Settings & Commission Rates
- **Method & Path:** `GET /api/dairy/settings`
- **Auth:** Admin

#### Update Commission Policy
- **Method & Path:** `PATCH /api/dairy/settings`
- **Auth:** Central Admin (`super_admin`)
- **Request Body:**
  ```json
  {
    "franchiseCommissionRate": 0.12,
    "companyCommissionRate": 0.08,
    "defaultRadiusKm": 20
  }
  ```

#### View Franchise Commission Ledger
- **Method & Path:** `GET /api/dairy/settings/commission/ledger`
- **Auth:** Admin or Assigned `franchise_owner`
- **Query Parameters:** `franchiseId`, `status` (`pending` / `paid`), `startDate`, `endDate`

---

## 3. Shiprocket Shipping & Courier APIs

All Shiprocket endpoints are protected by `adminOrSuperAdmin`.

| Method | Endpoint | Description | Parameters / Body |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/order/shiprocket/serviceability` | Check courier pincode serviceability | Query: `pickup_postcode`, `delivery_postcode`, `weight`, `cod` |
| `GET` | `/api/order/:id/shiprocket/serviceability`| Check courier serviceability for order | Path: `id` (Order ID) |
| `POST` | `/api/order/:id/shiprocket/create` | Create shipment order in Shiprocket | Body: `{ pickup_location, weight, length, breadth, height }` |
| `POST` | `/api/order/:id/shiprocket/assign-awb` | Assign AWB tracking code to shipment | Body: `{ courier_id }` (optional) |
| `POST` | `/api/order/:id/shiprocket/pickup` | Schedule courier pickup | Body: `{ pickup_date }` (optional) |
| `POST` | `/api/order/:id/shiprocket/label` | Generate printable shipping label | Path: `id` |
| `POST` | `/api/order/:id/shiprocket/manifest` | Generate shipment manifest | Path: `id` |
| `POST` | `/api/order/:id/shiprocket/print-manifest`| Print shipment manifest | Path: `id` |
| `GET` | `/api/order/:id/shiprocket/tracking` | Fetch live tracking status from Shiprocket | Path: `id` |
| `POST` | `/api/order/:id/shiprocket/cancel` | Cancel order in Shiprocket | Path: `id` |
| `PATCH`| `/api/order/:id/shipping-package` | Save package weight & dimensions | Body: `{ weight, length, breadth, height }` |

---

## 4. Customer Authentication & Account APIs

### Send Mobile OTP
- **Method & Path:** `POST /api/auth/user/send-otp`
- **Auth:** Public
- **Rate Limit:** 3 attempts / 10 minutes
- **Request Body:**
  ```json
  {
    "phoneNumber": "9876543210"
  }
  ```

### Verify Mobile OTP (Login / Register)
- **Method & Path:** `POST /api/auth/user/verify-otp`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "phoneNumber": "9876543210",
    "otp": "123456"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "_id": "673e...",
        "phone": "9876543210",
        "isPhoneVerified": true
      },
      "token": "eyJhbGciOi..."
    }
  }
  ```

### Additional User Auth Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/user/login` | Login with Phone/Email & 4-digit PIN |
| `POST` | `/api/auth/user/verify-login` | Verify 2FA login token |
| `POST` | `/api/auth/user/register` | Register new customer account |
| `POST` | `/api/auth/user/google` | Google OAuth token login |
| `POST` | `/api/auth/user/forgot-pin` | Request PIN reset OTP |
| `POST` | `/api/auth/user/reset-pin` | Set new 4-digit PIN with OTP |
| `GET` | `/api/auth/user/:id` | Get customer profile details |
| `PATCH`| `/api/auth/user/:id` | Update customer name / email |

---

## 5. Admin & Franchise Staff Management

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/admin/login` | Public | Admin or Franchise Owner login |
| `POST` | `/api/auth/admin/register` | Central Admin | Register outlet staff or sub-admin |
| `GET` | `/api/auth/admin/sub-admin` | Central Admin | List all sub-admins & franchise staff |
| `GET` | `/api/auth/admin/:id` | Admin | Get staff member profile |
| `PATCH`| `/api/auth/admin/edit/:id` | Central Admin | Update staff role or assigned outlet |
| `DELETE`|`/api/auth/admin/delete/:id`| Central Admin | Deactivate staff account |
| `POST` | `/api/auth/super-admin/register` | Super Admin Key | Root system admin creation |

---

## 6. Products & Dairy Catalog APIs

### Public Catalog Queries
- **`GET /api/product`**: List products with filtering:
  - Query parameters:
    - `isDairy`: `true` (Filter dairy products)
    - `dairyCategory`: `milk`, `curd`, `paneer`, `ghee`, `butter`, `sweets`
    - `category`: Category ObjectId
    - `sub_category`: SubCategory ObjectId
    - `search`: Name search query
    - `page`, `limit`: Pagination parameters
- **`GET /api/product/:id`**: Product details by ID or slug.
- **`GET /api/product/recommendations`**: Recommended products.

### Admin Product Management
| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/product` | Admin | Create product with unit (`L`, `ml`, `kg`, `g`, `pack`), shelf life, price |
| `PUT` | `/api/product/:id` | Admin | Full product update |
| `DELETE`| `/api/product/:id` | Admin | Delete product |
| `POST` | `/api/product/bulk` | Admin | Bulk product upload via Excel (.xlsx) |
| `GET` | `/api/product/export` | Admin | Export product catalog to Excel |
| `GET` | `/api/product/sample` | Admin | Download Excel import template |

---

## 7. Categories & Sub-Categories

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/category` | Public | List active categories |
| `POST` | `/api/category` | Admin | Create category |
| `GET` | `/api/category/:id` | Public | Get category details |
| `PUT` | `/api/category/:id` | Admin | Update category |
| `DELETE`| `/api/category/:id` | Admin | Delete category |
| `GET` | `/api/sub-category` | Public | List active sub-categories |
| `POST` | `/api/sub-category` | Admin | Create sub-category |
| `PUT` | `/api/sub-category/:id` | Admin | Update sub-category |
| `DELETE`| `/api/sub-category/:id` | Admin | Delete sub-category |

---

## 8. Shopping Cart APIs

All Cart endpoints require customer authentication (`user`).

| Method | Endpoint | Description | Request Body |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/cart` | Get current active cart | None (reads JWT user) |
| `POST` | `/api/cart` | Add item to cart | `{ "product_id": "...", "quantity": 1, "variant_sku": "base" }` |
| `DELETE`| `/api/cart/:id` | Remove item from cart | Path: Cart item ID |

---

## 9. Standard Orders & Payments

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/order` | User | Place order |
| `GET` | `/api/order/history` | User | View personal order history |
| `GET` | `/api/order` | Admin | List all orders with filters |
| `GET` | `/api/order/:id` | Admin | Order details |
| `PATCH`| `/api/order/:id/status` | Admin | Update order status |
| `PATCH`| `/api/order/:id/cancel` | User | Cancel unfulfilled order |
| `GET` | `/api/order/payment/:id/bill` | Admin | Download invoice PDF |
| `GET` | `/api/order/razorpay/config` | Public | Get Razorpay Key ID |
| `POST` | `/api/order/razorpay/create-order` | Optional User | Create Razorpay checkout order |
| `POST` | `/api/order/razorpay/verify-payment`| Optional User | Verify Razorpay payment signature |
| `POST` | `/api/order/:id/refund` | Admin | Issue gateway refund |

---

## 10. Webhooks (Razorpay, Cashfree, Shiprocket)

Webhooks run without user authentication and use cryptographically secure signature verification.

### 10.1 Razorpay Payment Webhook
- **Method & Path:** `POST /api/webhook/razorpay/payment`
- **Verification:** HMAC SHA256 over raw payload using `RAZORPAY_WEBHOOK_SECRET`.
- **Behavior:** Automatically marks orders as `paid` and advances status idempotently.

### 10.2 Shiprocket Tracking Webhook
- **Method & Path:** `POST /api/webhook/shiprocket`
- **Verification:** `x-api-key` header matches `SHIPROCKET_WEBHOOK_TOKEN`.
- **Behavior:** Synchronizes real-time courier statuses (`shipped`, `out_for_delivery`, `delivered`) and records tracking timestamps.

### 10.3 Cashfree Payment Webhook
- **Method & Path:** `POST /api/webhook/cashfree`
- **Verification:** HMAC SHA256 over raw payload + timestamp using `CASHFREE_SECRET_KEY`.
- **Behavior:** Confirms payment for orders processed via the Cashfree gateway.

---

## 11. Central Inventory & Warehouse

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/inventory` | Admin | List central warehouse stock |
| `GET` | `/api/inventory/stats` | Admin | Inventory value & turnover stats |
| `GET` | `/api/inventory/:sku` | Admin | Query SKU stock |
| `PATCH`| `/api/inventory/:sku/adjust` | Admin | Reconcile SKU stock |
| `POST` | `/api/inventory/:sku/restock`| Admin | Restock SKU |

---

## 12. Coupons & Promotional Banners

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/coupon/active` | Public | List active coupons |
| `POST` | `/api/coupon/validate` | User | Validate coupon code against cart amount |
| `POST` | `/api/coupon` | Admin | Create new coupon discount |
| `DELETE`| `/api/coupon/:id` | Admin | Deactivate coupon |
| `GET` | `/api/banner/active` | Public | Active homepage marketing banners |
| `POST` | `/api/banner` | Admin | Upload banner image (Multer/Cloudinary) |
| `DELETE`| `/api/banner/:id` | Admin | Delete banner |
| `GET` | `/api/marquee/active` | Public | Active scrolling announcement text for storefront/mobile |
| `GET` | `/api/marquee` | Admin | List all marquee announcements |
| `POST` | `/api/marquee` | Admin | Create marquee text (`text`, `order`, `is_active`) |
| `GET` | `/api/marquee/:id` | Admin | Get marquee details |
| `PUT` | `/api/marquee/:id` | Admin | Update marquee text / active state |
| `DELETE`| `/api/marquee/:id` | Admin | Delete marquee announcement |

---

## 13. Customer Addresses & Reviews

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/address` | User | List user's saved addresses |
| `POST` | `/api/address` | User | Add new address |
| `PUT` | `/api/address/:id` | User | Update address |
| `DELETE`| `/api/address/:id` | User | Delete address |
| `GET` | `/api/reviews/get-all` | Public | Get product reviews & ratings |
| `POST` | `/api/reviews/add` | User | Submit product review & rating |

---

## 14. Admin Dashboard & Analytics

All dashboard routes are restricted to `adminOrSuperAdmin`.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/dashboard/overview` | Platform KPI summary (Revenue, Orders, Products, Customers) |
| `GET` | `/api/dashboard/sales-overview` | Daily/weekly sales totals |
| `GET` | `/api/dashboard/monthly-growth` | Month-over-month growth rate |
| `GET` | `/api/dashboard/category-distribution`| Revenue breakdown by dairy product categories |
| `GET` | `/api/dashboard/revenue-trend` | Multi-month revenue charting data |

---

## 15. Blogs & Contact Us

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/blogs` | Public | List published articles & dairy recipes |
| `GET` | `/api/blogs/:id` | Public | View article content |
| `POST` | `/api/blogs` | Admin | Publish blog post |
| `POST` | `/api/contact-us` | Public | Submit customer support inquiry |
| `GET` | `/api/contact-us` | Admin | View customer support inquiries |
