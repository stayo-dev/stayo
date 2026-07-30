# Backend Reuse
# StayO Backend Reuse Strategy

Version: 1.0
Status: Active
Last Updated: July 2026

---

# Purpose

This document defines the backend migration strategy for StayO Version 1.

Rather than rebuilding the backend from scratch, StayO will reuse the proven business logic, database schema, authentication flow, and APIs from the existing Shri Adithya Hostel Management System.

The primary engineering effort in Version 1 is to build a completely new frontend while preserving as much backend functionality as possible.

This approach significantly reduces development time, minimizes regression risks, and allows the team to focus on user experience instead of rebuilding already tested functionality.

---

# Migration Philosophy

The migration follows one simple principle:

**Reuse business logic. Rebuild user experience.**

Existing backend code has already solved many operational problems including:

- Hostel management
- Room allocation
- Tenant management
- Authentication
- Complaints
- Payments
- Food management
- Reports

These modules should not be rewritten unless there is a technical or business requirement.

The frontend, however, will be redesigned from scratch to reflect the StayO product vision.

---

# Current Architecture

Current System

Frontend (Legacy)

↓

REST APIs

↓

Backend

↓

Supabase

↓

Storage

↓

Authentication

The legacy frontend is tightly coupled to the old branding and design.

The backend is modular enough to be reused.

---

# Target Architecture

StayO Frontend

↓

API Layer

↓

Existing Backend

↓

Supabase

↓

Storage

↓

Authentication

Only the presentation layer changes.

Business logic remains intact wherever possible.

---

# Components to Reuse

## Authentication

Reuse

Owner authentication

Tenant authentication

OTP verification

Session management

JWT handling

Password reset

Token validation

No rewrite required.

---

## Database

Reuse

Existing PostgreSQL schema.

Reuse existing migrations.

Avoid destructive schema changes.

Schema updates should be additive.

---

## API Endpoints

Reuse all stable endpoints.

Only create new endpoints if:

Business requirements change.

Existing endpoint is insufficient.

Performance improvements are required.

---

## File Storage

Reuse existing Supabase Storage buckets.

Avoid creating duplicate storage structures.

Existing upload logic should remain compatible.

---

## Authorization

Reuse existing role-based access control.

Roles currently supported:

Owner

Tenant

Future:

Admin

Warden

---

# Modules to Reuse

The following modules should be reused without redesigning backend logic.

## Hostel Management

Create hostel

Update hostel

Hostel configuration

Amenities

Rules

---

## Room Management

Create room

Update room

Delete room

Assign room

Vacate room

Transfer room

---

## Tenant Management

Invite tenant

Register tenant

Update tenant

Deactivate tenant

Profile management

---

## Payments

Payment history

Due calculations

Monthly rent

Outstanding balances

Payment status

---

## Complaint System

Complaint creation

Complaint status

Complaint history

Resolution tracking

---

## Food Module

Food schedules

Food polls

Voting

Menu management

---

## Reports

Revenue

Occupancy

Complaints

Food participation

Payment statistics

---

# Modules That May Require Backend Changes

Some features may require small backend modifications.

Examples:

Additional dashboard analytics

Improved search endpoints

Performance optimizations

Pagination improvements

Bulk actions

Notification enhancements

These should extend existing services rather than replace them.

---

# API Compatibility Rules

Every frontend request must use existing APIs whenever possible.

Do not duplicate endpoints.

Do not introduce parallel APIs for the same business function.

Maintain backward compatibility.

If an API must change:

Deprecate the old version.

Provide migration documentation.

Avoid breaking existing integrations.

---

# Database Change Policy

Database changes should follow these principles.

Preferred

Additive migrations

New tables

New columns

New indexes

Avoid

Dropping tables

Renaming columns

Breaking foreign keys

Deleting historical data

Legacy production data must always remain usable.

---

# Authentication Strategy

Continue using Supabase Authentication.

Supported methods

Email

Phone OTP

Invitation links

Session persistence

No custom authentication system will be developed.

---

# Business Logic Ownership

Business rules belong in the backend.

Examples

Rent calculation

Due date calculation

Room capacity validation

Food voting rules

Complaint status transitions

Frontend should only display and collect information.

Business decisions should remain server-side.

---

# Frontend Responsibilities

The new frontend is responsible for:

User experience

Design system

Responsive layouts

Form validation

Loading states

Error handling

Accessibility

State management

API consumption

It should not duplicate backend business logic.

---

# Backend Responsibilities

Authentication

Authorization

Validation

Database access

Business rules

Notifications

Reporting

Audit logs

Security

---

# Migration Process

Step 1

Clone existing backend.

↓

Step 2

Remove legacy frontend.

↓

Step 3

Integrate new StayO frontend.

↓

Step 4

Connect existing APIs.

↓

Step 5

Identify API gaps.

↓

Step 6

Implement only required backend changes.

↓

Step 7

Production testing.

---

# Success Criteria

The backend migration is considered successful when:

✓ Existing APIs continue working.

✓ Existing production data remains valid.

✓ New frontend functions correctly.

✓ No major business logic is duplicated.

✓ Existing users can migrate without data loss.

✓ Backend changes remain minimal.

---

# Risks

Potential risks include:

Legacy API inconsistencies.

Undocumented business rules.

Technical debt.

Database assumptions.

Performance bottlenecks.

These risks should be addressed through documentation and incremental refactoring rather than complete rewrites.

---

# Long-Term Strategy

Version 1 focuses on backend reuse.

Future versions may gradually modernize:

Service architecture

API versioning

Background jobs

Notification services

Analytics

However, modernization should be evolutionary rather than revolutionary.

The backend should continue serving production workloads throughout the transition.

---

# Engineering Principle

**If an existing backend solution satisfies the product requirement, reuse it.**

Only introduce new backend logic when there is a clear business, technical, or performance justification.

This principle minimizes risk, accelerates development, and preserves the stability of the StayO platform.