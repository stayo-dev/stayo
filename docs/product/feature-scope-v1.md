# Feature Scope — V1
# StayO Feature Scope (Version 1)

Version: 1.0
Status: Active
Last Updated: July 2026

---

# Purpose

This document defines the complete feature scope for StayO Version 1.

It acts as the single source of truth for product, design, and engineering teams regarding what is included in the first public release and what is intentionally excluded.

Version 1 focuses on replacing manual hostel operations with a centralized digital platform while maximizing reuse of the existing Shri Adithya backend.

The objective is not to build every possible hostel feature, but to deliver a stable, production-ready operating system for hostel owners.

---

# Product Goals

Version 1 must allow a hostel owner to manage their complete day-to-day operations digitally.

This includes:

• Owner onboarding

• Hostel configuration

• Room management

• Tenant management

• Payment tracking

• Food management

• Complaint management

• Reports

• Tenant communication

Every feature included in Version 1 should directly reduce manual work performed by hostel owners.

---

# User Roles

Version 1 supports the following roles.

## Owner

Primary user.

Responsibilities:

- Register with StayO
- Complete onboarding
- Configure hostel
- Add rooms
- Invite tenants
- Track rent
- Manage complaints
- Create food polls
- Publish food schedules
- View reports

---

## Tenant

Secondary user.

Responsibilities:

- Login using owner invitation
- View dashboard
- View payment history
- View room information
- Vote in food polls
- View food schedule
- Raise complaints
- Receive announcements

---

## Admin

Internal role.

Responsibilities:

- Verify owner registrations
- Activate owner account
- Support customers

Admin dashboard UI is not part of Version 1.

Operational activities remain internal.

---

# Included Features

---

# 1. Public Website

Included

Features:

- Landing page
- Product overview
- Features
- Pricing
- Contact
- Owner registration
- Login

Purpose:

Generate owner leads and explain the product.

---

# 2. Owner Registration

Included

Owner submits:

- Name
- Phone
- Email
- Hostel Name
- Hostel Location

After submission:

Lead is created.

Internal team contacts owner manually.

---

# 3. Owner Activation

Included

Activation is manual.

Workflow:

Lead Created

↓

Internal Verification

↓

Activation Link

↓

Owner Receives Email / WhatsApp

↓

Owner Starts Onboarding

No automatic approval exists in Version 1.

---

# 4. Owner Onboarding

Included

Owner configures:

- Personal Details
- Hostel Information
- Floors
- Rooms
- Capacity
- Basic Settings

Onboarding is completed once minimum hostel setup exists.

---

# 5. Owner Dashboard

Included

Modules:

Dashboard

Rooms

Tenants

Payments

Complaints

Food

Reports

Settings

Notifications

---

# Dashboard Overview

Displays:

Total Rooms

Occupied Beds

Vacant Beds

Revenue

Pending Payments

Open Complaints

Today's Activities

Upcoming Due Payments

Recent Tenant Activity

---

# 6. Room Management

Included

Owner can:

Create Room

Edit Room

Delete Room

Assign Tenant

Vacate Tenant

View Occupancy

View Room Details

Track Available Beds

---

# 7. Tenant Management

Included

Owner can:

Invite Tenant

View Tenant Profile

Edit Tenant

Deactivate Tenant

View Payment History

Assign Room

Transfer Room

View Complaint History

---

# Tenant Invitation

Version 1 uses manual invitation.

Workflow:

Owner clicks Invite Tenant

↓

Invitation Link Generated

↓

Owner shares link

↓

Tenant completes onboarding

↓

Tenant account becomes active

---

# 8. Payments

Included

Owner can:

Track Rent

View Due Payments

Mark Payment Received

View History

Generate Payment Records

Payment reminders are manual or notification-based.

Online payment gateway is excluded.

---

# 9. Complaint Management

Included

Tenant can:

Create Complaint

Upload Images (optional)

Track Status

Owner can:

View Complaint

Assign Status

Resolve Complaint

Close Complaint

Statuses:

Open

In Progress

Resolved

Closed

---

# 10. Food Module

Included

Food Polls

Meal Voting

Food Schedule

Weekly Menu

Monthly Menu

Owner publishes final schedule after voting.

Tenants can only vote before poll closes.

---

# 11. Reports

Included

Occupancy

Revenue

Due Payments

Complaint Statistics

Food Participation

Monthly Summary

Reports are viewable within dashboard.

Export functionality may be added later.

---

# 12. Notifications

Included

Payment Reminder

Complaint Update

Food Poll

Food Schedule

Announcements

System Alerts

---

# Tenant Portal

Included

Dashboard

Payments

Complaints

Food

Profile

Notifications

Room Information

Settings

---

# Settings

Included

Hostel Details

Owner Profile

Password

Notification Preferences

Basic Branding

---

# Excluded Features

The following features are intentionally excluded from Version 1.

> **Enforced in code as of 2026-09-03** (see `docs/obsidian/Decisions.md` ADR-170). The Stayo Discover marketplace, the owner listing/marketing flow, the audience-fork `WelcomePage` at `/`, and the "Explore" nav tab were built ahead of v1 and are now **shelved for v2**: frontend routes are unmounted and the backend APIs (`/api/discover/*`, `/api/owner/hostels/*/marketing/*`, `/api/platform-admin/marketing-reviews/*`) return `410` unless `MARKETPLACE_ENABLED=true`. All code is retained on disk.

Marketplace Discovery

Public Hostel Search

Online Booking

Room Reservation

Online Payments

Subscription Billing

AI Recommendations

Dynamic Pricing

Multiple Hostel Owners

Manager Roles

Staff Management

Inventory Management

Visitor Management

Biometric Attendance

Gate Pass System

Laundry Module

Marketplace Reviews

Referral Program

Analytics Dashboard for Admin

These features may be considered in future versions.

---

# Engineering Principles

Version 1 should:

Reuse existing backend APIs whenever possible.

Avoid backend rewrites unless absolutely necessary.

Build a completely new frontend.

Follow the new StayO design system.

Maintain API compatibility.

Minimize migration effort.

Deliver production stability over feature quantity.

---

# Release Criteria

Version 1 is considered complete when:

✓ Owner can onboard successfully

✓ Hostel can be configured

✓ Rooms can be managed

✓ Tenants can be invited

✓ Tenants can access their portal

✓ Payments can be tracked

✓ Complaints can be managed

✓ Food polls are operational

✓ Reports display correctly

✓ Existing backend supports all workflows

No Version 1 release should introduce features outside this document without updating this specification first.