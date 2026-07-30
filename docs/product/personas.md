# Personas
# StayO User Personas

Version: 1.0

Status: Active

Last Updated: July 2026

---

# Purpose

This document defines the primary users of StayO.

Each persona represents a real user group that interacts with the platform.

These personas guide:

- Product decisions
- UX decisions
- UI design
- Feature prioritization
- Backend permissions
- API design

Whenever a new feature is proposed, it should answer:

> Which persona benefits from this feature?

If no persona benefits, the feature should be reconsidered.

---

# Primary Personas

StayO Version 1 supports three primary personas:

1. Owner
2. Tenant
3. Super Admin

Future versions will introduce:

- Manager
- Warden
- Support Executive

---

# Persona 1 — Hostel Owner

## Overview

The Hostel Owner is the primary customer of StayO.

They operate one or more student hostels and use StayO to replace manual operations with a digital platform.

StayO is built primarily to solve the owner's operational challenges.

---

## Profile

Age

25–60

Technical Knowledge

Basic to Intermediate

Devices

Android Phone

Laptop

Desktop

Primary Device

Mobile Phone

---

## Goals

Manage hostel efficiently.

Reduce paperwork.

Track rent payments.

Manage tenant records.

Monitor occupancy.

Handle complaints.

Publish food schedules.

Generate reports.

Reduce operational errors.

Save time every day.

---

## Daily Activities

Morning

Check dashboard.

Review pending payments.

Review complaints.

Check today's food schedule.

---

Throughout the Day

Add new tenants.

Transfer rooms.

Update payments.

Resolve complaints.

Send reminders.

---

Evening

Review reports.

Check occupancy.

Plan next day's operations.

---

## Pain Points

Paper registers.

Manual rent calculations.

WhatsApp communication overload.

Lost payment records.

Difficulty tracking vacant rooms.

Delayed complaint resolution.

No centralized system.

Time-consuming reporting.

---

## Success Metrics

Owner spends less than 30 minutes per day managing operations.

Payments are tracked accurately.

Occupancy is always visible.

Complaints are resolved faster.

Reports are generated automatically.

---

## StayO Solutions

Centralized dashboard.

Automated calculations.

Digital tenant records.

Real-time occupancy.

Complaint tracking.

Food scheduling.

Reports.

Notifications.

---

# Persona 2 — Tenant

## Overview

The Tenant lives in the hostel and interacts with StayO for personal hostel-related activities.

The tenant should never feel overwhelmed by unnecessary features.

The tenant experience should remain simple.

---

## Profile

Age

17–30

Technical Knowledge

Intermediate

Primary Device

Android Phone

---

## Goals

View payment status.

Check food schedule.

Vote in food polls.

Raise complaints.

Receive announcements.

View room information.

Stay informed.

---

## Daily Activities

Check notifications.

View today's menu.

Vote in polls.

Track payments.

Raise complaints if needed.

---

## Pain Points

No visibility into payment status.

Unclear food schedule.

Delayed complaint updates.

Missing announcements.

Difficulty contacting management.

---

## Success Metrics

Tenant finds information within a few seconds.

Food schedule is always available.

Complaint progress is transparent.

Payment history is clear.

---

## StayO Solutions

Personal dashboard.

Food section.

Complaint tracking.

Notifications.

Payment history.

Digital profile.

---

# Persona 3 — Super Admin

## Overview

The Super Admin manages the StayO platform rather than an individual hostel.

They ensure smooth onboarding, monitor platform health, and support hostel owners.

---

## Profile

Technical Knowledge

Advanced

Primary Device

Desktop

Laptop

---

## Goals

Approve owner registrations.

Monitor platform usage.

Support customers.

Review analytics.

Maintain platform stability.

---

## Responsibilities

Review new owner applications.

Activate owner accounts.

Suspend accounts if required.

Monitor platform performance.

Resolve operational issues.

---

## Pain Points

Manual onboarding requests.

Difficulty tracking multiple hostels.

Limited operational visibility.

Support delays.

---

## Success Metrics

Owners are onboarded quickly.

Support requests are resolved efficiently.

Platform remains stable.

Operational metrics are visible.

---

## StayO Solutions

Admin dashboard.

Owner approval workflow.

Platform analytics.

Support tools.

Audit logs.

---

# Future Persona — Hostel Manager

Status

Future Version

Responsibilities

Daily operations.

Room management.

Tenant coordination.

Complaint resolution.

Food management.

Cannot access billing or ownership settings.

---

# Future Persona — Warden

Status

Future Version

Responsibilities

Monitor hostel activities.

Handle complaints.

View room occupancy.

Coordinate with tenants.

Limited operational access.

---

# Future Persona — Support Executive

Status

Future Version

Responsibilities

Customer support.

Issue tracking.

Diagnostics.

Platform assistance.

No access to financial records.

---

# Persona Comparison

| Attribute | Owner | Tenant | Super Admin |
|------------|--------|---------|-------------|
| Primary Device | Mobile | Mobile | Desktop |
| Uses Dashboard Daily | Yes | Yes | Yes |
| Manages Hostel | Yes | No | Platform |
| Views Reports | Yes | No | Yes |
| Creates Payments | Yes | No | No |
| Creates Complaints | No | Yes | No |
| Approves Owners | No | No | Yes |
| Manages Food | Yes | View Only | No |

---

# UX Priorities by Persona

## Owner

Fast operations.

Minimal clicks.

High information density.

Business insights.

Operational efficiency.

---

## Tenant

Simple interface.

Large touch targets.

Minimal navigation.

Clear status indicators.

Fast loading.

---

## Super Admin

Analytics first.

Table-based workflows.

Bulk actions.

Monitoring.

System visibility.

---

# Feature Priority Matrix

| Feature | Owner | Tenant | Admin |
|----------|--------|---------|-------|
| Dashboard | High | High | High |
| Payments | High | Medium | Low |
| Food | High | High | Low |
| Complaints | High | High | Medium |
| Reports | High | Low | High |
| Settings | Medium | Low | Medium |
| Notifications | Medium | High | Medium |

---

# Design Principles Per Persona

Owner

Prioritize efficiency over visual complexity.

Tenant

Prioritize simplicity over feature richness.

Super Admin

Prioritize visibility, monitoring, and operational control.

---

# Summary

StayO is an owner-first platform.

The majority of product decisions should optimize the hostel owner's operational efficiency while ensuring tenants have a simple, intuitive, and transparent experience.

The Super Admin supports platform growth and operational stability without interfering in day-to-day hostel management.