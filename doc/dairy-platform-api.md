# Multi-Outlet Dairy E-Commerce Platform API Documentation (Bihar)

This document describes all API endpoints, data models, authentication flows, and operational procedures for the Multi-Outlet Dairy Platform built on top of the existing backend.

---

## 1. Authentication & Role Permissions

### Roles
1. **`super_admin` / `admin` (Central Admin)**: Full administrative control over all outlets, products, commission policies, inventory restock, payouts, settings, and reports.
2. **`franchise_owner` (Franchise Owner / Outlet Staff)**: Associated with a specific `franchise` ID. Isolated strictly to their own outlet's inventory, customer pickup verification, orders, and commission earnings.
3. **Customer**: Authenticates via Mobile SMS OTP (`/api/auth/user/send-otp` & `/api/auth/user/verify-otp`) or existing 4-digit PIN / Google Auth.

---

## 2. Customer Authentication Endpoints

### 2.1 Send Mobile OTP
- **Route:** `POST /api/auth/user/send-otp`
- **Rate Limit:** 3 requests per 10 minutes
- **Request Body:**
  ```json
  {
    "phoneNumber": "9876543210"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "statusCode": 200,
    "data": {
      "phone": "9876543210",
      "expiresInMinutes": 10
    },
    "message": "OTP sent successfully to your mobile number",
    "success": true
  }
  ```

### 2.2 Verify Mobile OTP & Login
- **Route:** `POST /api/auth/user/verify-otp`
- **Rate Limit:** 5 requests per 10 minutes
- **Request Body:**
  ```json
  {
    "phoneNumber": "9876543210",
    "otp": "123456",
    "name": "Ramesh Kumar"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "statusCode": 200,
    "data": {
      "user": {
        "id": "67329...",
        "name": "Ramesh Kumar",
        "phone": "9876543210"
      },
      "accessToken": "eyJhbGciOi..."
    },
    "message": "Logged in successfully via mobile OTP",
    "success": true
  }
  ```

---

## 3. Outlet Discovery & QR Ordering

### 3.1 Proximity-Based Nearest Eligible Outlets
- **Route:** `GET /api/dairy/outlets/nearby`
- **Query Parameters:**
  - `longitude`: (Required, Number, e.g. `85.1376`)
  - `latitude`: (Required, Number, e.g. `25.5941`)
  - `radiusKm`: (Optional, default from StoreSettings or 15 km)
  - `items`: (Optional JSON array of `{ productId, quantity }` to filter only outlets with available stock)
- **Response (200 OK):**
  Returns array of active outlets sorted by geographic proximity using MongoDB 2dsphere index.

### 3.2 Outlet QR Scan (Locked Flow)
- **Route:** `GET /api/dairy/outlets/qr/:token`
- **Parameters:**
  - `token`: Unique `qrToken` (e.g., `OUT_PAT01_A9BF`) or outlet code (`PAT01`)
- **Response (200 OK):**
  ```json
  {
    "statusCode": 200,
    "data": {
      "outlet": {
        "_id": "6732a...",
        "name": "Sudha Dairy Corner - Kankarbagh",
        "code": "PAT01",
        "address": {
          "street": "Main Road",
          "locality": "Kankarbagh",
          "city": "Patna",
          "state": "Bihar"
        },
        "operatingHours": {
          "openingTime": "06:00",
          "closingTime": "21:00"
        }
      },
      "isQrLocked": true
    },
    "message": "Connected to Sudha Dairy Corner - Kankarbagh. Outlet selection locked.",
    "success": true
  }
  ```

### 3.3 List All Active Outlets
- **Route:** `GET /api/dairy/outlets`
- **Response (200 OK):** List of all active outlets in Bihar.

---

## 4. Dairy Inventory Management (Per-Outlet)

### 4.1 List Outlet Inventory
- **Route:** `GET /api/dairy/inventory/:franchiseId`
- **Headers:** `Authorization: Bearer <Admin/FranchiseOwner Token>`
- **Access:** Central Admin or Franchise Owner assigned to `:franchiseId`
- **Query Parameters:**
  - `page`, `per_page`, `search`
  - `filter`: `"all"`, `"low_stock"`, `"out_of_stock"`
- **Response (200 OK):**
  Returns items with `quantity_on_hand`, `reserved_quantity`, and dynamic `available_quantity`.

### 4.2 Restock Item at Outlet
- **Route:** `POST /api/dairy/inventory/restock`
- **Headers:** `Authorization: Bearer <Admin/FranchiseOwner Token>`
- **Request Body:**
  ```json
  {
    "franchiseId": "6732a...",
    "productId": "6732b...",
    "quantity": 50,
    "lowStockThreshold": 10
  }
  ```

---

## 5. Dairy Order Placement & Pickup Workflow

### 5.1 Dairy Checkout (Pickup Only)
- **Route:** `POST /api/dairy/orders/checkout`
- **Headers:** Optional `Authorization: Bearer <Customer Token>`
- **Request Body:**
  ```json
  {
    "franchiseId": "6732a...",
    "items": [
      { "productId": "6732b...", "quantity": 2 },
      { "productId": "6732c...", "quantity": 1 }
    ],
    "customerName": "Ramesh Kumar",
    "customerPhone": "9876543210",
    "customerEmail": "ramesh@example.com",
    "paymentGateway": "razorpay",
    "isQrLocked": true
  }
  ```
- **Business Behavior:**
  1. Atomically reserves stock at outlet (`reserved_quantity` incremented conditionally).
  2. Requires no delivery address; shipping fee is 0.
  3. Generates 6-digit `pickupOtp` and saves on order.
  4. Calculates immutable commission snapshot based on product / franchise / global hierarchy.
  5. Initializes Razorpay / Cashfree order.

### 5.2 Payment Verification
- **Route:** `POST /api/dairy/orders/verify-payment`
- **Request Body:**
  ```json
  {
    "orderId": "6732d...",
    "razorpay_order_id": "order_xyz",
    "razorpay_payment_id": "pay_xyz",
    "razorpay_signature": "signature_hex"
  }
  ```
- **Business Behavior:**
  1. Verifies HMAC-SHA256 signature server-side.
  2. Updates `paymentStatus: "paid"`, `status: "confirmed"`, `pickupStatus: "ready_for_pickup"`.
  3. Sends SMS to customer with Pickup OTP and outlet name.
  4. Idempotent: repeated calls do not corrupt order state.

### 5.3 Outlet Staff Pickup Verification (Duplicate-Safe)
- **Route:** `POST /api/dairy/orders/pickup/verify`
- **Headers:** `Authorization: Bearer <Staff/Admin Token>`
- **Request Body:**
  ```json
  {
    "orderId": "6732d...",
    "otp": "654321"
  }
  ```
- **Security & Concurrency Protections:**
  1. Verifies staff admin belongs to the order's franchise outlet.
  2. Atomically checks `pickupStatus !== 'picked_up'`.
  3. If already picked up, returns 409 Conflict with timestamp.
  4. On successful OTP match: marks `pickupStatus: "picked_up"`, `status: "delivered"`.
  5. Commits reserved stock deduction.
  6. Finalizes immutable record in `CommissionLedger` (unique index prevents duplicates).
  7. Sends customer SMS confirmation of successful pickup.

### 5.4 Order Cancellation & Stock Release
- **Route:** `POST /api/dairy/orders/:orderId/cancel`
- **Request Body:** `{ "reason": "Customer cancelled" }`
- **Business Behavior:**
  Atomically releases reserved stock back to outlet available inventory pool.

---

## 6. Central Admin Settings & Commission Ledger

### 6.1 View & Update Store Settings
- **`GET /api/dairy/settings`**: Central admin inspects radius, commission defaults, active gateways, audit logs.
- **`PATCH /api/dairy/settings`**: Central admin updates global radius or commission rates; creates audit log entry.

### 6.2 View Commission Ledger & Earnings
- **`GET /api/dairy/settings/commission/ledger`**:
  - Scoped: Franchise Owner sees only their outlet's earnings. Central Admin sees all.
  - Supports filters by date range, payout status (`accrued`, `paid`), and franchise.
  - Returns aggregate totals for `totalOutletEarnings` and `totalPlatformEarnings`.

### 6.3 Process Commission Payout
- **`PATCH /api/dairy/settings/commission/payout`**:
  - Central Admin marks ledger IDs as `paid` with bank transfer / UTR reference.
