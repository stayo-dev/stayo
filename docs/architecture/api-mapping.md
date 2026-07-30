# API Mapping
# StayO API Mapping Specification

Version: 1.0

Status: Active

Last Updated: July 2026

---

# Purpose

This document defines how the new StayO frontend communicates with the existing backend.

Its objectives are to:

• Map every frontend screen to backend APIs.

• Reuse existing backend endpoints wherever possible.

• Prevent duplicate business logic.

• Standardize request and response handling.

• Define authentication requirements.

• Define frontend responsibilities.

This document acts as the contract between frontend and backend.

---

# API Design Principles

StayO Version 1 follows these principles.

1. Backend owns business logic.

2. Frontend owns presentation.

3. APIs should be reused before creating new ones.

4. Never duplicate business rules in React.

5. Every API should return predictable responses.

6. Authentication required unless explicitly public.

---

# API Architecture

Frontend

↓

API Client

↓

Authentication Middleware

↓

REST API

↓

Controllers

↓

Services

↓

Database

↓

Supabase

---

# API Standards

Protocol

HTTPS

Format

JSON

Authentication

Bearer JWT

Encoding

UTF-8

Timezone

UTC

Date Format

ISO-8601

Currency

Indian Rupees (INR)

---

# Standard Response Format

Success

{
    success: true,
    message: "",
    data: {}
}

---

Failure

{
    success: false,
    message: "",
    error: {}
}

---

Validation Error

{
    success: false,
    validationErrors: []
}

---

# Authentication APIs

Purpose

User login and session management.

Frontend Screens

Login

Activation

Forgot Password

Profile

Session Restore

APIs

POST /auth/login

POST /auth/logout

POST /auth/refresh

POST /auth/verify-otp

POST /auth/forgot-password

POST /auth/reset-password

GET /auth/me

---

# Owner Onboarding APIs

Frontend Screens

Owner Registration

Activation

Onboarding

Dashboard

Required APIs

POST /owners/register

GET /owners/profile

PUT /owners/profile

POST /hostels

PUT /hostels/:id

GET /hostels/:id

---

# Dashboard APIs

Owner Dashboard

Widgets

Revenue

Occupancy

Pending Payments

Complaints

Activities

Notifications

Suggested Endpoints

GET /dashboard

GET /dashboard/stats

GET /dashboard/activity

GET /dashboard/notifications

---

# Room APIs

Frontend Screen

Rooms

Room Details

Create Room

Edit Room

Required Endpoints

GET /rooms

GET /rooms/:id

POST /rooms

PUT /rooms/:id

DELETE /rooms/:id

POST /rooms/:id/assign

POST /rooms/:id/vacate

POST /rooms/:id/transfer

---

Frontend Responsibilities

Pagination

Sorting

Filtering

Search

Optimistic Updates

---

# Tenant APIs

Screens

Tenant List

Tenant Details

Invite Tenant

Profile

Endpoints

GET /tenants

GET /tenants/:id

POST /tenants

PUT /tenants/:id

DELETE /tenants/:id

POST /tenants/invite

POST /tenants/activate

---

Frontend Responsibilities

Search

Filters

Status Display

Avatar Rendering

---

# Payment APIs

Screens

Payments

Dashboard

Tenant Details

Endpoints

GET /payments

GET /payments/:id

POST /payments

PUT /payments/:id

GET /payments/history

GET /payments/due

---

Business Rules

Handled only by backend

Rent calculation

Late fee

Balance

Due date

Collection rate

---

# Complaint APIs

Screens

Complaint List

Complaint Details

Create Complaint

Endpoints

GET /complaints

GET /complaints/:id

POST /complaints

PUT /complaints/:id

PATCH /complaints/status

DELETE /complaints/:id

---

Frontend Responsibilities

Status Colors

Timeline

Priority Display

Filters

Image Preview

---

# Food APIs

Screens

Food Dashboard

Food Poll

Food Schedule

Endpoints

GET /food/menu

POST /food/menu

PUT /food/menu

GET /food/polls

POST /food/polls

POST /food/vote

GET /food/results

---

Backend Responsibilities

Vote counting

Winner calculation

Schedule publishing

---

# Reports APIs

Screens

Reports

Revenue

Occupancy

Payments

Complaints

Endpoints

GET /reports/revenue

GET /reports/payments

GET /reports/occupancy

GET /reports/food

GET /reports/complaints

---

# Notifications APIs

Endpoints

GET /notifications

PATCH /notifications/read

DELETE /notifications/:id

---

# Settings APIs

GET /settings

PUT /settings

PUT /profile

PUT /password

PUT /notifications/preferences

---

# File Upload APIs

Profile Image

Complaint Images

Documents

Endpoints

POST /upload

DELETE /upload

GET /files/:id

---

# API Authentication

Every authenticated request should include

Authorization

Bearer <JWT>

If expired

↓

Refresh Token

↓

Retry Request

↓

Logout if refresh fails

---

# API Error Handling

400

Validation Error

401

Unauthorized

403

Forbidden

404

Not Found

409

Conflict

422

Validation Failed

429

Rate Limited

500

Internal Server Error

503

Maintenance

---

Frontend Behavior

401

Redirect Login

404

Show Not Found

500

Retry Button

Network Failure

Offline UI

---

# Request Lifecycle

User Action

↓

Validation

↓

Loading State

↓

API Request

↓

Success Response

↓

Update UI

↓

Toast

OR

↓

Error Response

↓

Display Error

↓

Retry

---

# Caching Strategy

Dashboard

5 minutes

Rooms

Realtime Refresh

Tenants

Manual Refresh

Reports

No Cache

Settings

Session Cache

---

# Pagination

Default Page Size

20

Maximum

100

Infinite Scroll

Not used

Use numbered pagination for consistency.

---

# Search

Client Side

Small datasets

Server Side

Large datasets

Debounce

300ms

---

# Retry Strategy

GET

Retry twice

POST

No automatic retry

DELETE

No automatic retry

PUT

Manual retry

---

# Loading Strategy

Skeleton

Dashboard

Spinner

Buttons

Progress

Uploads

Placeholder

Images

---

# Logging

Frontend logs

UI errors

Network failures

Unhandled exceptions

Backend logs

Validation

Authentication

Business logic

Database

---

# Security

Never expose service role keys.

Never store JWT in local variables accessible to third-party scripts.

Sanitize all user input.

Validate every request server-side.

Enforce role-based authorization on every protected endpoint.

---

# Existing Backend Reuse

The following modules should reuse existing endpoints whenever available.

✓ Authentication

✓ Hostel Management

✓ Room Management

✓ Tenant Management

✓ Payments

✓ Complaints

✓ Food

✓ Reports

Only introduce new endpoints when no suitable API exists or a new business requirement demands it.

---

# API Versioning

Current Version

v1

Future Changes

Introduce /v2 only when breaking changes cannot be avoided.

Maintain backward compatibility during migration whenever possible.

---

# API Testing Checklist

Before integrating any endpoint verify:

✓ Authentication works

✓ Authorization enforced

✓ Validation messages correct

✓ Empty responses handled

✓ Loading states implemented

✓ Error states implemented

✓ Mobile responsiveness unaffected

✓ Performance acceptable

---

# Conclusion

The API layer is the bridge between the new StayO frontend and the existing backend.

The frontend should remain lightweight, relying on backend services for business logic while focusing on delivering a fast, accessible, and consistent user experience.

This document serves as the implementation contract for all API integrations in StayO Version 1.