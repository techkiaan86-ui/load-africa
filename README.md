# 🚚 LoadAfrica — Backend REST API Server

Node.js, Express, and Prisma ORM backend services for the **LoadAfrica** logistics platform.

---

## ⚡ Technical Architecture

- **Database**: MySQL 8.0 with Prisma ORM 5.
- **Authentication**: JWT authentication with role-based middleware (`requireAuth`, `requireRole`).
- **Pricing Engine**: Server-side distance pricing ($ \text{Distance KM} \times \text{Vehicle Category Rate Per KM} $) with fuel surcharges, tolls, platform fees, and VAT calculations.
- **Transporter Matching Engine**: Distance radius matching, driver KYC eligibility checks, active vehicle verification, and load offers dispatch.

---

## 🛠️ Setup & Execution

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment (`.env`)**:
   ```env
   PORT=5000
   DATABASE_URL="mysql://root:password@localhost:3306/load_africa"
   JWT_SECRET="your_secure_jwt_secret_key"
   ```

3. **Synchronize Schema & Seed Categories**:
   ```bash
   npx prisma db push
   node src/utils/seedVehicleCategories.js
   ```

4. **Start Development Server**:
   ```bash
   npm run dev
   ```
