# QuickPoint Backend

Multi-Outlet Dairy E-Commerce Platform for Bihar.

Node.js / Express / MongoDB backend providing outlet discovery, real-time inventory reservations, QR-code ordering, mobile OTP authentication, online payment processing, pickup OTP verification, and immutable franchise commission ledgers.

---

## 🥛 Key Platform Features

1. **Multi-Outlet Franchise Architecture (Bihar)**
   - Outlets mapped with GeoJSON `Point` coordinates and `2dsphere` geospatial indexing for proximity lookups.
   - Unique outlet QR codes and QR tokens for in-store instant ordering.
   - Strict franchise role isolation (`centralAdmin` vs `franchiseOwner`).

2. **Dairy Catalog & Outlet Inventory**
   - Products with unit types (`L`, `ml`, `kg`, `g`, `pack`), shelf life, storage temperatures, and dairy categories (`milk`, `curd`, `paneer`, `ghee`, `butter`, `sweets`).
   - Outlet-level atomic inventory reservations (`reservedStock`, `availableStock`, `physicalStock`).

3. **Customer Mobile OTP Authentication**
   - Fast login and registration via Indian 10-digit mobile numbers with SMS OTP verification.
   - Protected with brute-force rate limiters (3 attempts / 10 minutes).

4. **100% Pickup-Only Fulfillment**
   - Zero shipping fees and no delivery addresses required.
   - 6-digit pickup verification OTP generated on order payment.
   - Authorized franchise staff verification with atomic double-pickup prevention.

5. **Online Payment & Idempotency**
   - Razorpay standard checkout and webhook verification.
   - Optional Cashfree gateway provider with webhook HMAC SHA256 signature verification.
   - Idempotent payment processing: multiple webhook deliveries will not double-credit orders.

6. **Immutable Commission Ledger**
   - Financial snapshots captured at the exact moment of order payment (`franchiseCut`, `companyCut`, `franchiseRate`, `companyRate`).
   - Subsequent rate changes in store settings do not affect historical orders or accounting.

---

## 🚀 Getting Started

### Prerequisites
- Node.js `v20+`
- MongoDB `v6.0+` with Replica Set (for GeoJSON indexing & transactions)

### Installation
```bash
git clone <repo-url>
cd thequickpointbe
npm install
```

### Environment Configuration
Copy `env.example` to `.env` and fill in credentials:
```bash
cp env.example .env
```

### Running Tests
Run the automated multi-outlet dairy test suite:
```bash
npm test
```

### Running the Server
```bash
# Development (with nodemon)
npm run dev

# Production
npm start
```

---

## 📖 API Documentation
Detailed API endpoints and request/response specifications are documented in:
- [Complete API Reference Manual](file:///Users/sayemkalim/Desktop/thequickpointbe/doc/API_REFERENCE.md) (All 150+ Endpoints)
- [Multi-Outlet Dairy API Documentation](file:///Users/sayemkalim/Desktop/thequickpointbe/doc/dairy-platform-api.md)
- Interactive Swagger UI: `http://localhost:5000/api-doc`
