# Full_Backend_info.md

Version : 1.0

Project Type
Enterprise Multi-Portal Logistics & Heavy Equipment Rental Platform

Backend Stack

- Node.js
- Express.js
- Prisma ORM
- MySQL (XAMPP)
- JWT Authentication
- Bcrypt
- Multer
- Socket.io
- Nodemailer
- Zod Validation
- Morgan Logger
- Helmet
- CORS
- dotenv

---

# BACKEND OBJECTIVE

The backend acts as the single source of truth for the entire LoadAfrica platform.

Every portal communicates with the same backend.

Customer Portal

↓

Driver Portal

↓

Fleet Portal

↓

Yellow Plant Portal

↓

Broker Portal

↓

Admin Portal

↓

Express Backend

↓

Prisma ORM

↓

MySQL Database

There must never be duplicate business logic.

Every operation must go through centralized services.

---

# BACKEND ARCHITECTURE

Request

↓

Express Route

↓

Authentication Middleware

↓

Role Middleware

↓

Validation Middleware

↓

Controller

↓

Service

↓

Repository (Prisma)

↓

Database

↓

Response Formatter

↓

Frontend

No controller should directly access Prisma.

Controllers only receive request and return response.

Business logic belongs inside Services.

Database queries belong inside Repository Layer.

---

# PROJECT FOLDER STRUCTURE

backend/

src/

config/

controllers/

routes/

middlewares/

services/

repositories/

validators/

prisma/

socket/

cron/

emails/

utils/

constants/

helpers/

uploads/

logs/

types/

app.js

server.js

.env

---

# CONFIG MODULE

Responsible for

Database

JWT

SMTP

Environment Variables

Socket

Application Settings

No business logic should exist here.

---

# ROUTES

Routes only map URL to Controller.

Example

POST /auth/login

↓

AuthController.login()

Routes must never contain business logic.

---

# CONTROLLERS

Controller Responsibilities

Receive Request

Validate Input

Call Service

Return Response

Handle Exceptions

Controllers must remain small.

Maximum responsibility

Input → Service → Response

---

# SERVICES

Services contain complete business logic.

Examples

Booking Service

Authentication Service

Fleet Service

Driver Service

Plant Service

Broker Service

Payment Service

Wallet Service

Notification Service

Maintenance Service

Services communicate with Repository Layer only.

---

# REPOSITORY LAYER

Repository is responsible for Prisma.

No business logic.

Only

Create

Update

Delete

Find

Aggregate

Transactions

Every Prisma query belongs here.

---

# PRISMA ORM

Use Prisma for every database operation.

Never use raw SQL unless absolutely required.

All Relations must use Prisma Relation Mapping.

Every Migration handled by Prisma.

Database remains synchronized.

---

# AUTHENTICATION

Authentication Method

JWT Access Token

Future Support

Refresh Token

Password Reset

Email Verification

Session Tracking

Every protected API requires Authentication.

---

# AUTHORIZATION

Role Based Access Control (RBAC)

Roles

Customer

Driver

Fleet Owner

Plant Owner

Broker

Admin

Super Admin

Each API defines allowed roles.

Example

Customer cannot access Admin APIs.

Driver cannot update Fleet information.

---

# PASSWORD SECURITY

Passwords stored using

bcrypt

Never store plain text password.

Password comparison always uses bcrypt compare.

---

# VALIDATION

Every incoming request must be validated.

Validation Library

Zod

Validation occurs before Controller execution.

Reject invalid requests immediately.

---

# RESPONSE FORMAT

Every API returns the same format.

Success

{
success
message
data
}

Failure

{
success
message
errors
}

No random response formats.

---

# ERROR HANDLING

Global Error Middleware

Handles

Validation Errors

JWT Errors

Database Errors

Server Errors

Unhandled Exceptions

All errors return standardized responses.

---

# FILE UPLOAD MODULE

Handles

Driver License

Vehicle Documents

Insurance

Plant Certificates

Invoices

Proof Of Delivery

Profile Photos

Equipment Images

Uploads stored in dedicated folders.

Future Cloud Storage Supported.

---

# EMAIL MODULE

Responsible for

Welcome Email

OTP

Password Reset

Booking Confirmation

Hire Confirmation

Invoice

Maintenance Reminder

SMTP configurable using .env

---

# SOCKET.IO

Real Time Events

Booking Created

Booking Accepted

Driver Assigned

Trip Started

Trip Completed

Driver Location

Equipment Assigned

Hire Started

Notifications

Only real-time features use Socket.

---

# CRON JOBS

Daily Background Jobs

Document Expiry

Insurance Reminder

License Reminder

Maintenance Reminder

Pending Payment Reminder

Wallet Settlement

Inactive Account Cleanup

Runs automatically.

---

# AUDIT LOGGING

Every important action is logged.

Examples

Login

Logout

Booking Created

Booking Updated

Booking Cancelled

Driver Assigned

Equipment Assigned

Payment Released

Admin Actions

Logs stored permanently.

---

# NOTIFICATION MODULE

Supports

In App Notification

Email Notification

Future

SMS

Push Notification

WhatsApp

Every module uses centralized Notification Service.

---

# PAYMENT MODULE

Handles

Booking Payment

Plant Hire Payment

Wallet

Revenue

Platform Commission

Withdraw Request

Transactions

Invoices

All payment operations must be transactional.

---

# DATABASE TRANSACTIONS

Use Prisma Transactions whenever multiple tables are updated.

Examples

Booking Accepted

↓

Update Booking

Update Vehicle

Create Assignment

Create Notification

Create Audit Log

Either everything succeeds or everything rolls back.

---

# SOFT DELETE POLICY

Business records are never permanently deleted.

Tables contain

deleted_at

Deleted records remain recoverable.

---

# SECURITY

Helmet

CORS

Rate Limiter

JWT

Password Hashing

Input Validation

SQL Injection Protection

Prisma Safe Queries

Environment Variables

Never expose secrets.

---

# ENVIRONMENT VARIABLES

DATABASE_URL

PORT

JWT_SECRET

JWT_EXPIRES

SMTP_HOST

SMTP_PORT

SMTP_USER

SMTP_PASS

SOCKET_PORT

UPLOAD_PATH

CLIENT_URL

SERVER_URL

---

# NAMING CONVENTION

Folders

lowercase

Files

camelCase

Controllers

AuthController

BookingController

DriverController

FleetController

PlantController

Services

AuthService

BookingService

DriverService

Repositories

BookingRepository

DriverRepository

Models handled by Prisma

No duplicate naming.

---

# CODING RULES

Controllers should remain lightweight.

Business Logic belongs only in Services.

Database Queries belong only in Repository Layer.

Never duplicate logic.

Never duplicate validation.

Never duplicate response formatting.

Always reuse utilities.

Always use async/await.

Never use callback-based code.

---

# API VERSIONING

All APIs begin with

/api/v1/

Future versions

/api/v2/

/api/v3/

without breaking old clients.

---

# LOGGING

Morgan Request Logger

Application Logs

Error Logs

Audit Logs

Separate log files.

---

# FUTURE SCALABILITY

Backend must support

Mobile App

Admin Dashboard

Partner APIs

Payment Gateway

Google Maps

GPS Tracking

Cloud Storage

SMS Gateway

AI Pricing Engine

without major architectural changes.

---

# DEVELOPMENT PRINCIPLES

Single Source of Truth

Reusable Services

Reusable Validation

Reusable Middleware

Centralized Error Handling

Centralized Authentication

Centralized Notifications

Centralized Payments

No duplicated code.

---

END OF DOCUMENT
