# LOADAFRICA
# Full_frontend_info.md

Version: 1.0

Project Type:
Enterprise Multi-Portal Logistics & Heavy Equipment Platform

Frontend Stack

- React.js
- Vite
- Tailwind CSS
- React Router DOM
- Axios
- React Hook Form
- Zod
- React Hot Toast
- Lucide React Icons
- Socket.io Client
- Google Maps API

---

# OBJECTIVE

The frontend must be built as a modular, scalable and enterprise-level React application.

Every portal shares the same design system.

Every portal communicates with the same backend.

No duplicate components.

No duplicate pages.

No duplicate business logic.

Frontend should only consume APIs.

All business logic remains inside backend services.

---

# PROJECT STRUCTURE

frontend/

src/

assets/

components/

layouts/

pages/

hooks/

context/

services/

utils/

constants/

validators/

routes/

types/

styles/

App.jsx

main.jsx

---

# PAGE STRUCTURE

Landing Website

↓

Authentication

↓

Role Detection

↓

Role Based Dashboard

Customer

Driver

Fleet Owner

Yellow Plant

Broker

Admin

---

# LAYOUT STRUCTURE

Every portal has its own layout.

CustomerLayout

DriverLayout

FleetLayout

PlantLayout

BrokerLayout

AdminLayout

Each layout contains

Sidebar

Top Navbar

Notification Panel

Profile Dropdown

Responsive Navigation

Outlet

---

# ROUTING

Use React Router DOM.

Every route must be protected.

Guest Routes

/login

/register

/forgot-password

/reset-password

Protected Routes

/customer

/driver

/fleet

/plant

/broker

/admin

Unauthorized users must be redirected automatically.

---

# ROLE BASED ROUTING

Customer

↓

Customer Dashboard

Driver

↓

Driver Dashboard

Fleet Owner

↓

Fleet Dashboard

Plant Owner

↓

Plant Dashboard

Broker

↓

Broker Dashboard

Admin

↓

Admin Dashboard

Never allow users to access another role's pages.

---

# COMPONENT STRUCTURE

Reusable Components

Button

Input

Select

Textarea

Modal

Table

Card

Badge

Avatar

Pagination

Search

Filter

Status Chip

Loading Spinner

Skeleton

Toast

Empty State

Error State

Timeline

File Upload

Google Map

OTP Input

Rating

Document Preview

Every page should reuse these components.

---

# STATE MANAGEMENT

Global State

Authentication

User

Notifications

Theme

Socket Connection

Do NOT duplicate state.

Business data should always come from backend APIs.

---

# API LAYER

Create centralized API services.

Example

services/

authService.js

bookingService.js

driverService.js

fleetService.js

plantService.js

brokerService.js

adminService.js

paymentService.js

trackingService.js

notificationService.js

uploadService.js

Never call Axios directly inside pages.

Always use Service Layer.

---

# AXIOS CONFIGURATION

Create one axios instance.

Automatically attach

JWT Token

Refresh Token

Headers

Handle

401 Unauthorized

403 Forbidden

500 Errors

Automatically redirect to Login when session expires.

---

# FORM HANDLING

Use

React Hook Form

+

Zod Validation

Every form must validate before API call.

Never trust frontend validation alone.

Backend validation remains mandatory.

---

# AUTHENTICATION FLOW

User Login

↓

Receive JWT

↓

Store Token

↓

Fetch User Profile

↓

Redirect according to Role

↓

Load Dashboard

↓

Open Socket Connection

Logout

↓

Clear Token

↓

Disconnect Socket

↓

Redirect Login

---

# SOCKET FLOW

Connect after login.

Listen for

Booking Created

Booking Accepted

Driver Assigned

Trip Started

Trip Completed

Hire Accepted

Payment Received

Notifications

Live Tracking

Update UI instantly.

---

# CUSTOMER FLOW

Dashboard

↓

Create Booking

↓

Quotation

↓

Booking Submitted

↓

Booking Details

↓

Tracking

↓

Payment

↓

History

↓

Profile

---

# DRIVER FLOW

Dashboard

↓

Available Loads

↓

Accept

↓

Trip

↓

Tracking

↓

OTP

↓

POD Upload

↓

Wallet

↓

Profile

---

# FLEET FLOW

Dashboard

↓

Booking Requests

↓

Assign Driver

↓

Vehicles

↓

Revenue

↓

Maintenance

↓

Profile

---

# YELLOW PLANT FLOW

Dashboard

↓

Hire Requests

↓

Assign Equipment

↓

Assign Operator

↓

Equipment

↓

Maintenance

↓

Revenue

↓

Profile

---

# BROKER FLOW

Dashboard

↓

Quote Requests

↓

Assign Fleet

↓

Customers

↓

Commission

↓

Profile

---

# ADMIN FLOW

Dashboard

↓

Users

↓

Drivers

↓

Fleet

↓

Plant

↓

Broker

↓

Bookings

↓

Payments

↓

Reports

↓

Settings

---

# FILE UPLOAD FLOW

Upload

↓

Validate

↓

Preview

↓

API Upload

↓

Database Save

↓

Return URL

↓

Display File

Supported

PDF

PNG

JPG

JPEG

DOCX

---

# GOOGLE MAPS

Use Google Maps API.

Support

Autocomplete

Pickup Location

Delivery Location

Distance

ETA

Current Driver Location

Route Display

Live Tracking

---

# TABLE RULES

Every table must support

Search

Sort

Filter

Pagination

Export

Status

Actions

Responsive Layout

---

# DASHBOARD RULES

Every dashboard contains

Statistics

Charts

Recent Activity

Notifications

Quick Actions

Latest Updates

No static values.

Always use backend APIs.

---

# LOADING STATES

Show Skeleton Loader

During API requests.

Never leave blank screens.

---

# EMPTY STATES

Show meaningful empty state.

Example

"No Bookings Found"

"No Vehicles Available"

"No Equipment Assigned"

---

# ERROR HANDLING

Handle

404

401

403

422

500

Show Toast Messages.

Never expose backend errors.

---

# RESPONSIVE DESIGN

Desktop

Laptop

Tablet

Mobile

All pages must be fully responsive.

No overflow.

No broken layouts.

---

# UI CONSISTENCY

Use same

Typography

Spacing

Buttons

Cards

Tables

Forms

Colors

Icons

Across every portal.

Never redesign individual pages differently.

---

# NOTIFICATIONS

Real-time notification panel.

Unread count.

Mark as Read.

View All.

Auto Update.

---

# ACCESSIBILITY

Keyboard Navigation

ARIA Labels

Focus States

Readable Contrast

Screen Reader Friendly

---

# PERFORMANCE

Lazy Loading

Code Splitting

Memoization

Debounced Search

Optimized Images

Reusable Components

Avoid unnecessary re-renders.

---

# FRONTEND RULES

Do NOT hardcode API responses.

Do NOT hardcode user data.

Do NOT duplicate components.

Do NOT duplicate pages.

Always use centralized services.

Always follow Flow.md.

Always follow DB_Schema.md.

Always follow API_Specification.md.

Always follow Full_Backend_info.md.

Maintain one consistent enterprise architecture across the entire project.

---

# FINAL GOAL

The frontend must behave as a production-ready enterprise logistics platform.

Every portal should be connected through backend APIs.

Every user action should follow the business workflow defined in Flow.md.

No broken navigation.

No isolated pages.

No duplicate logic.

The application should feel like a real-world SaaS product ready for production deployment.

END OF DOCUMENT  