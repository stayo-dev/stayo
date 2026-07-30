# Permissions
# StayO Permission & Access Control

Version: 1.0

Status: Active

Last Updated: July 2026

---

# Purpose

This document defines the authorization model for StayO Version 1.

It specifies:

- User roles
- Access levels
- Route protection
- Feature permissions
- API authorization
- UI visibility
- Future role expansion

Authentication verifies who a user is.

Authorization determines what that user is allowed to do.

This document is the source of truth for all permission-related decisions across the frontend and backend.

---

# Permission Philosophy

StayO follows Role-Based Access Control (RBAC).

Permissions are assigned to roles rather than individual users.

Every authenticated user belongs to exactly one role.

Version 1 supports:

- Super Admin
- Owner
- Tenant

Future versions will introduce:

- Manager
- Warden
- Support Executive

---

# Access Levels

Level 0

Public

Accessible without login.

Examples

Landing Page

Pricing

About

Contact

Privacy Policy

Terms

---

Level 1

Authenticated

Accessible after successful login.

Role restrictions still apply.

---

Level 2

Owner

Access only to their hostel.

Cannot access other hostels.

---

Level 3

Tenant

Access only to personal data.

Cannot modify hostel configuration.

---

Level 4

Super Admin

Access to all hostels.

Access to system management.

Can approve owner registrations.

Can monitor platform health.

---

# User Roles

## Public Visitor

Purpose

Prospective hostel owner.

Permissions

✓ View landing page

✓ View pricing

✓ Submit enquiry

✓ Register interest

✗ Cannot access dashboard

✗ Cannot view hostel data

---

## Owner

Purpose

Manages one hostel.

Primary Responsibilities

Hostel setup

Room management

Tenant management

Payments

Food

Complaints

Reports

Settings

Owner Dashboard

Full access to their hostel only.

---

## Tenant

Purpose

Resident of a hostel.

Primary Responsibilities

View profile

View room

View payments

View food schedule

Vote in food polls

Raise complaints

Receive notifications

Tenant Dashboard

Cannot access owner modules.

---

## Super Admin

Purpose

Platform administrator.

Responsibilities

Approve owners

View all hostels

Manage platform

Platform analytics

Support

System settings

Future billing

---

# Route Protection

## Public Routes

/

/pricing

/contact

/login

/register

/forgot-password

No authentication required.

---

## Owner Routes

/dashboard

/rooms

/tenants

/payments

/food

/complaints

/reports

/settings

Authentication required.

Role must be Owner.

---

## Tenant Routes

/tenant/dashboard

/tenant/profile

/tenant/payments

/tenant/food

/tenant/complaints

Authentication required.

Role must be Tenant.

---

## Admin Routes

/admin

/admin/owners

/admin/hostels

/admin/users

/admin/platform

/admin/settings

Authentication required.

Role must be Super Admin.

---

# Owner Permissions

Hostel

✓ View

✓ Edit

✗ Delete after activation

---

Rooms

✓ Create

✓ Edit

✓ Delete (only when vacant)

✓ Assign tenants

✓ Transfer tenants

✓ Vacate rooms

---

Tenants

✓ Invite

✓ Activate

✓ Edit

✓ Deactivate

✗ Delete historical records

---

Payments

✓ Record payment

✓ View payment history

✓ Export payment data

✓ Send reminders

✗ Delete payment history

---

Complaints

✓ View all complaints

✓ Change status

✓ Add resolution

✓ Close complaints

---

Food

✓ Create menus

✓ Create food polls

✓ Publish schedules

✓ View voting analytics

---

Reports

✓ Revenue

✓ Occupancy

✓ Payments

✓ Food

✓ Complaints

✓ Export reports

---

Settings

✓ Update profile

✓ Update hostel information

✓ Configure notifications

✓ Change password

---

# Tenant Permissions

Profile

✓ View

✓ Edit personal details (where allowed)

---

Room

✓ View assigned room

✗ Change room

---

Payments

✓ View history

✓ Download receipt (if available)

✗ Modify payment records

---

Food

✓ View menu

✓ Vote in active polls

✓ Submit meal feedback

---

Complaints

✓ Create

✓ View own complaints

✓ Add attachments

✗ View other tenants' complaints

---

Notifications

✓ View

✓ Mark as read

---

Settings

✓ Change password

✓ Update notification preferences

---

# Super Admin Permissions

Owners

✓ Approve registrations

✓ Suspend owner accounts

✓ Reactivate owners

---

Hostels

✓ View all

✓ Edit platform-level metadata

✗ Modify day-to-day hostel operations

---

Platform

✓ Manage users

✓ View analytics

✓ Configure platform settings

✓ Review audit logs

---

# API Authorization

Every protected endpoint must verify:

1. Authentication
2. User Role
3. Resource Ownership

Example

Owner requesting:

GET /rooms

Backend verifies:

✓ Logged in

✓ Owner role

✓ Hostel ownership

Only then return data.

---

# Resource Ownership

Owners

May only access records belonging to their hostel.

Tenants

May only access their own records.

Admins

May access all records.

---

# UI Visibility Rules

Hide UI elements the user cannot access.

Do not display disabled controls for unauthorized actions unless required for clarity.

Examples

Tenant

Hide "Create Room"

Owner

Hide "Platform Settings"

Public

Hide all dashboard navigation

---

# Route Guards

Frontend

Redirect unauthorized users.

Backend

Reject unauthorized requests.

Never rely solely on frontend checks.

---

# Error Responses

401 Unauthorized

User not logged in.

Redirect to Login.

---

403 Forbidden

User lacks permission.

Show Access Denied page.

---

404 Not Found

Resource unavailable or does not belong to user.

---

# Audit Requirements

Log permission-sensitive actions.

Examples

Owner approval

Room deletion

Tenant deactivation

Payment recording

Complaint resolution

Hostel settings changes

Audit logs are immutable.

---

# Future Roles

## Manager

Delegated operational access.

Can manage rooms, tenants, complaints, and food.

Cannot change billing or ownership.

---

## Warden

Operational access only.

Can:

View tenants

Manage complaints

View food schedules

Check occupancy

Cannot:

Access payments

Modify hostel settings

Approve owners

---

## Support Executive

Internal StayO role.

Can:

View support tickets

Assist owners

Access diagnostic logs

Cannot modify business data.

---

# Permission Matrix

| Feature | Public | Tenant | Owner | Admin |
|----------|--------|--------|-------|-------|
| Landing Page | ✓ | ✓ | ✓ | ✓ |
| Login | ✓ | ✓ | ✓ | ✓ |
| Owner Dashboard | ✗ | ✗ | ✓ | ✓ |
| Tenant Dashboard | ✗ | ✓ | ✗ | ✓ |
| Rooms | ✗ | View Assigned | Full | Full |
| Tenants | ✗ | Own Profile | Full | Full |
| Payments | ✗ | Own Payments | Full | Full |
| Food | ✗ | View & Vote | Full | Full |
| Complaints | ✗ | Own | Full | Full |
| Reports | ✗ | ✗ | ✓ | ✓ |
| Platform Settings | ✗ | ✗ | ✗ | ✓ |

---

# Security Principles

- Never trust frontend authorization.
- Every API validates permissions.
- Hide unauthorized UI.
- Log privileged actions.
- Follow least privilege.
- Revoke access immediately after role changes.

---

# Future Expansion

The permission system should support:

- Multiple hostels per owner
- Custom role templates
- Fine-grained permissions
- Team management
- Temporary access
- Feature flags
- Enterprise role policies

The architecture should allow these additions without redesigning the authorization model.

---

# Summary

StayO uses a Role-Based Access Control (RBAC) model where every user belongs to a role with clearly defined permissions.

Authorization is enforced at both the frontend and backend.

The permission system is designed to be secure, scalable, and extensible while maintaining a simple experience for Version 1.