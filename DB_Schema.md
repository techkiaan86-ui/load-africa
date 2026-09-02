# DB_Schema.md
Version : 1.0

Database
---------
MySQL (XAMPP)

ORM
----
Prisma ORM

Database Design
----------------
Relational Database (Normalized)

Target
-------
Enterprise Multi Portal Logistics Management System

--------------------------------------------------------
DATABASE OVERVIEW
--------------------------------------------------------

The entire LoadAfrica platform uses ONE centralized database.

Every portal shares the same database.

Customer Portal
Driver Portal
Fleet Portal
Yellow Plant Portal
Broker Portal
Admin Portal

There are NO separate databases.

Every table is connected using Foreign Keys.

--------------------------------------------------------
DATABASE NAMING CONVENTION
--------------------------------------------------------

Tables
snake_case

Columns
snake_case

Primary Key

id

Foreign Keys

xxxxx_id

Date Fields

created_at

updated_at

deleted_at (Soft Delete)

Boolean

is_active

is_verified

is_deleted

--------------------------------------------------------
MASTER TABLES
--------------------------------------------------------

1.
users

Purpose

Stores authentication information for every user.

Columns

id

uuid

email

password

role

status

is_verified

last_login

created_at

updated_at

Relationships

1 User

↓

Customer

Driver

Fleet Owner

Plant Owner

Broker

Admin

--------------------------------------------------------

2.
roles

Stores system roles.

Example

ADMIN

CUSTOMER

DRIVER

FLEET_OWNER

PLANT_OWNER

BROKER

SUPER_ADMIN

--------------------------------------------------------

3.
customers

Customer Profile

Linked

user_id

--------------------------------------------------------

4.
drivers

Driver Profile

Linked

user_id

Current Status

Available

Busy

Offline

Documents

License

PDP

ID

--------------------------------------------------------

5.
fleet_owners

Fleet Company Information

Linked

user_id

--------------------------------------------------------

6.
plant_owners

Yellow Plant Companies

Linked

user_id

--------------------------------------------------------

7.
brokers

Broker Company Information

Linked

user_id

--------------------------------------------------------

8.
admins

Administrator Details

Linked

user_id

--------------------------------------------------------
VEHICLE MODULE
--------------------------------------------------------

vehicles

Fleet Vehicles

Owner

fleet_owner_id

Columns

registration_number

vehicle_type

capacity

status

insurance_expiry

roadworthy_expiry

tracking_device

--------------------------------------------------------

vehicle_documents

vehicle_id

document_type

expiry_date

file

--------------------------------------------------------

vehicle_maintenance

vehicle_id

issue

cost

status

service_date

--------------------------------------------------------

--------------------------------------------------------
YELLOW PLANT MODULE
--------------------------------------------------------

equipment

Owner

plant_owner_id

Columns

equipment_name

category

manufacturer

model

serial_number

operating_weight

hourly_rate

daily_rate

status

engine_hours

insurance_expiry

inspection_expiry

--------------------------------------------------------

equipment_documents

equipment_id

document_type

expiry_date

file

--------------------------------------------------------

equipment_maintenance

equipment_id

issue

cost

service_date

status

--------------------------------------------------------

operators

Operator Profile

user_id

license_number

experience

availability

--------------------------------------------------------

--------------------------------------------------------
BOOKING MODULE
--------------------------------------------------------

bookings

Central Logistics Booking

customer_id

vehicle_type

pickup

dropoff

cargo_type

weight

distance

estimated_price

status

--------------------------------------------------------

booking_assignments

booking_id

fleet_owner_id

vehicle_id

driver_id

assigned_by

assigned_at

--------------------------------------------------------

tracking

booking_id

driver_id

latitude

longitude

speed

heading

timestamp

--------------------------------------------------------

booking_history

booking_id

old_status

new_status

changed_by

timestamp

--------------------------------------------------------
YELLOW PLANT RENTALS
--------------------------------------------------------

hire_requests

customer_id

equipment_type

location

duration

start_date

estimated_price

status

--------------------------------------------------------

equipment_assignments

hire_request_id

equipment_id

operator_id

assigned_by

assigned_at

--------------------------------------------------------
PAYMENT MODULE
--------------------------------------------------------

payments

booking_id

hire_request_id

customer_id

amount

tax

platform_fee

status

payment_method

--------------------------------------------------------

wallets

user_id

balance

pending_balance

withdrawable_balance

--------------------------------------------------------

wallet_transactions

wallet_id

type

amount

reference

status

--------------------------------------------------------

withdraw_requests

wallet_id

amount

bank_details

status

--------------------------------------------------------
NOTIFICATION MODULE
--------------------------------------------------------

notifications

user_id

title

message

type

is_read

--------------------------------------------------------
DOCUMENT MANAGEMENT
--------------------------------------------------------

documents

owner_type

owner_id

document_type

file

expiry_date

verification_status

--------------------------------------------------------
REVIEW MODULE
--------------------------------------------------------

reviews

booking_id

customer_id

driver_id

rating

comment

--------------------------------------------------------
AUDIT MODULE
--------------------------------------------------------

audit_logs

user_id

action

module

ip_address

device

browser

timestamp

--------------------------------------------------------
SYSTEM SETTINGS
--------------------------------------------------------

settings

key

value

--------------------------------------------------------
ENUMS
--------------------------------------------------------

UserRole

ADMIN

SUPER_ADMIN

CUSTOMER

DRIVER

FLEET_OWNER

PLANT_OWNER

BROKER

--------------------------------------------------------

BookingStatus

PENDING

QUOTED

ASSIGNED

ACCEPTED

PICKUP

IN_TRANSIT

DELIVERED

COMPLETED

CANCELLED

--------------------------------------------------------

EquipmentStatus

AVAILABLE

RESERVED

ON_HIRE

MAINTENANCE

--------------------------------------------------------

VehicleStatus

AVAILABLE

ASSIGNED

IN_TRANSIT

MAINTENANCE

--------------------------------------------------------

PaymentStatus

PENDING

PAID

FAILED

REFUNDED

--------------------------------------------------------

MaintenanceStatus

SCHEDULED

IN_PROGRESS

COMPLETED

--------------------------------------------------------

WithdrawalStatus

PENDING

APPROVED

REJECTED

PAID

--------------------------------------------------------
FOREIGN KEY RELATIONSHIPS
--------------------------------------------------------

users

↓

customers

drivers

fleet_owners

plant_owners

brokers

admins

--------------------------------------------------------

fleet_owners

↓

vehicles

↓

vehicle_documents

↓

vehicle_maintenance

--------------------------------------------------------

plant_owners

↓

equipment

↓

equipment_documents

↓

equipment_maintenance

--------------------------------------------------------

customers

↓

bookings

↓

payments

↓

reviews

--------------------------------------------------------

customers

↓

hire_requests

↓

equipment_assignments

↓

payments

--------------------------------------------------------

bookings

↓

tracking

↓

booking_history

↓

booking_assignments

--------------------------------------------------------

wallets

↓

wallet_transactions

↓

withdraw_requests

--------------------------------------------------------
INDEXES
--------------------------------------------------------

Unique

email

registration_number

serial_number

license_number

--------------------------------------------------------

Indexes

booking_status

equipment_status

vehicle_status

payment_status

created_at

--------------------------------------------------------
SOFT DELETE POLICY
--------------------------------------------------------

Every business table contains

deleted_at

No data should be permanently deleted.

--------------------------------------------------------
PRISMA GUIDELINES
--------------------------------------------------------

Use UUID for IDs.

Use Prisma Relations for every Foreign Key.

Enable Prisma Migrate.

Do NOT use raw SQL unless required.

Use Decimal for Money.

Use DateTime for timestamps.

Use Enum for Status Fields.

Every table must have

created_at

updated_at

Use @@index wherever filtering is frequent.

--------------------------------------------------------
DATABASE RULES
--------------------------------------------------------

One Driver

can only have

One Active Trip.

--------------------------------------------------------

One Vehicle

cannot have

Multiple Active Bookings.

--------------------------------------------------------

One Equipment

cannot have

Multiple Active Hire Requests.

--------------------------------------------------------

One Wallet

belongs to

One User.

--------------------------------------------------------

Payments always create

Wallet Transactions.

--------------------------------------------------------

Booking completion automatically updates

Wallet

Revenue

Audit Logs

Notifications

--------------------------------------------------------

Everything is synchronized using one centralized SQL database.

END OF DOCUMENT
