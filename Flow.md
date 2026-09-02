# Complete System Workflow
Version: 1.0
Project Type: Enterprise Multi-Portal Logistics & Heavy Equipment Platform

---

# 1. PROJECT OVERVIEW

LoadAfrica is a centralized logistics platform that connects Customers, Drivers,
Fleet Owners, Yellow Plant Owners, Brokers and Administrators through one
shared backend and one centralized database.

Every module communicates with the same backend.

There are NO isolated systems.

Any action performed in one portal immediately affects all related portals.

Example:

Customer creates booking
        ↓
Broker/Admin receives booking
        ↓
Fleet receives request
        ↓
Fleet assigns Driver
        ↓
Driver starts trip
        ↓
Customer tracks vehicle
        ↓
Admin monitors everything
        ↓
Payment released
        ↓
Wallet updated

All modules remain synchronized.

---

# 2. SYSTEM PORTALS

The platform contains the following portals.

1. Landing Website
2. Customer Portal
3. Driver Portal
4. Fleet Owner Portal
5. Yellow Plant Portal
6. Broker Portal
7. Admin Portal

All portals use the same backend APIs.

---

# 3. USER REGISTRATION FLOW

Guest User

↓

Landing Website

↓

Choose Account Type

Customer
Driver
Fleet Owner
Plant Owner
Broker

↓

Complete Registration

↓

Upload Required Documents

↓

Pending Verification

↓

Admin Reviews Account

↓

Approved

↓

User can Login

Rejected users cannot access dashboard.

---

# 4. AUTHENTICATION FLOW

User

↓

Enter Email & Password

↓

Backend Authentication

↓

JWT Token Generated

↓

Role Identified

↓

Redirect to Correct Portal

Customer
Driver
Fleet
Plant
Broker
Admin

Unauthorized users cannot access protected routes.

---

# 5. CUSTOMER BOOKING FLOW

Customer Dashboard

↓

Create Booking

↓

Enter Pickup

↓

Enter Dropoff

↓

Vehicle Type

↓

Cargo Information

↓

Quotation Generated

↓

Booking Submitted

↓

Booking Status = Pending

↓

Notification Sent

Admin

Broker

Fleet Owners

Booking now waits for assignment.

---

# 6. BROKER FLOW

Broker receives pending quotation.

↓

Reviews booking.

↓

May contact customer.

↓

Assign booking to Fleet Owner

OR

Reject Booking

↓

Fleet Owner notified.

---

# 7. FLEET OWNER FLOW

Fleet receives booking request.

↓

Review Booking

↓

Accept / Reject

↓

Select Vehicle

↓

Assign Driver

↓

Booking Status Updated

↓

Driver receives assignment.

Vehicle becomes unavailable.

---

# 8. DRIVER FLOW

Driver receives assignment.

↓

Review Trip

↓

Accept

↓

Navigate to Pickup

↓

Arrived Pickup

↓

Pickup Confirmed

↓

Trip Started

↓

GPS Tracking Active

↓

Delivery Completed

↓

Customer OTP Verification

↓

POD Upload

↓

Trip Completed

↓

Wallet Updated

↓

Driver Available Again

---

# 9. LIVE TRACKING FLOW

Trip Started

↓

GPS Updates

↓

Backend receives coordinates

↓

Customer Portal updates

↓

Fleet Portal updates

↓

Admin updates

↓

Driver ETA updates

Tracking ends after delivery.

---

# 10. PAYMENT FLOW

Trip Completed

↓

Invoice Generated

↓

Customer Payment

↓

Platform Commission

↓

Remaining Balance

↓

Fleet Wallet Updated

↓

Driver Earnings Updated

↓

Admin Revenue Updated

↓

Transaction History Stored

---

# 11. DRIVER WALLET FLOW

Completed Trip

↓

Payment Released

↓

Wallet Balance Updated

↓

Driver Requests Withdrawal

↓

Admin Approval (optional)

↓

Bank Transfer

↓

Wallet History Updated

---

# 12. FLEET REVENUE FLOW

Completed Booking

↓

Revenue Generated

↓

Platform Fee Deducted

↓

Fleet Wallet Updated

↓

Withdraw Request

↓

Bank Transfer

↓

Revenue History Updated

---

# 13. YELLOW PLANT RENTAL FLOW

Customer selects

Yellow Plant Hire

↓

Choose Equipment

↓

Select Dates

↓

Submit Hire Request

↓

Request Status = Pending

↓

Plant Owner Receives Request

↓

Review Request

↓

Accept / Reject

↓

Select Equipment

↓

Assign Operator

↓

Equipment Status = On Hire

↓

Operator Assigned

↓

Rental Starts

↓

Tracking Active

↓

Rental Ends

↓

Payment Released

↓

Equipment Available Again

---

# 14. EQUIPMENT MAINTENANCE FLOW

Plant Owner

↓

Open Maintenance

↓

Select Equipment

↓

Create Service Record

↓

Equipment Status

Maintenance

↓

Equipment Hidden From Rentals

↓

Service Completed

↓

Equipment Status

Available

---

# 15. EQUIPMENT REGISTRATION FLOW

Plant Owner

↓

Add Equipment

↓

Equipment Details

↓

VIN

↓

Manufacturer

↓

Weight

↓

Rental Rates

↓

Insurance

↓

Certificates

↓

Save

↓

Equipment Available For Hire

---

# 16. ADMIN FLOW

Admin Dashboard

↓

View Users

↓

View Drivers

↓

View Fleet

↓

View Plant Owners

↓

View Brokers

↓

View Bookings

↓

View Hire Requests

↓

Approve Accounts

↓

Suspend Accounts

↓

Monitor Payments

↓

View Audit Logs

↓

Platform Analytics

Admin has access to entire platform.

---

# 17. NOTIFICATION FLOW

Events

Booking Created

Booking Accepted

Driver Assigned

Trip Started

Trip Completed

Payment Received

Maintenance Reminder

Document Expiry

↓

Notification Service

↓

Customer

Driver

Fleet

Plant

Broker

Admin

---

# 18. DOCUMENT EXPIRY FLOW

System Cron Job

↓

Daily Scan

↓

Driving License

Vehicle Insurance

Plant Insurance

Roadworthy

Operator License

↓

Expiring Soon

↓

Notification Sent

↓

Expired Documents

↓

Account Restriction (if required)

---

# 19. BOOKING STATUS FLOW

Pending

↓

Quoted

↓

Assigned

↓

Accepted

↓

Driver Assigned

↓

Pickup

↓

In Transit

↓

Delivered

↓

Completed

OR

Cancelled

---

# 20. HIRE REQUEST STATUS FLOW

Pending

↓

Accepted

↓

Equipment Assigned

↓

Operator Assigned

↓

On Hire

↓

Completed

OR

Rejected

OR

Cancelled

---

# 21. VEHICLE STATUS FLOW

Available

↓

Reserved

↓

Assigned

↓

Pickup

↓

In Transit

↓

Delivered

↓

Available

OR

Maintenance

---

# 22. EQUIPMENT STATUS FLOW

Available

↓

Reserved

↓

On Hire

↓

Maintenance

↓

Available

---

# 23. SYSTEM OWNERSHIP

Customer owns only his bookings.

Driver owns only assigned trips.

Fleet Owner owns only registered vehicles.

Plant Owner owns only registered equipment.

Broker owns only assigned quotations.

Admin owns complete platform.

No portal can modify another owner's private data unless authorized.

---

# 24. GLOBAL DATA SYNCHRONIZATION

Every update must synchronize across all portals.

Example:

Customer creates booking

↓

Broker Dashboard updates

↓

Fleet Dashboard updates

↓

Admin Dashboard updates

↓

Notifications generated

Another example:

Plant accepts hire request

↓

Equipment status changes

↓

Customer rental updates

↓

Admin dashboard updates

↓

Revenue updates

↓

Operator assignment updates

There must never be duplicated state.

All modules use the same centralized database.
