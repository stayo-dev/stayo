# Navigation
# StayO Navigation Specification

Version: 1.0

Status: Active

Last Updated: July 2026

---

# Purpose

This document defines the navigation architecture of StayO Version 1.

It specifies how users move throughout the application, how navigation changes based on user role, and how the navigation behaves across desktop, tablet, and mobile devices.

Navigation should always prioritize speed, clarity, and minimal cognitive load.

---

# Navigation Philosophy

StayO follows four navigation principles.

1. Never make users think.

Navigation labels should use simple language instead of technical terminology.

Example:

✔ Rooms

✔ Tenants

✔ Payments

✘ Occupancy Management

✘ Resident Administration

---

2. Reach any primary feature within two clicks.

A hostel owner should never need to navigate deeply through multiple menus to perform daily operations.

---

3. Keep navigation consistent.

The sidebar order should remain consistent across every page.

Only page content should change.

---

4. Mobile-first.

Every navigation decision should work on phones before desktops.

---

# Application Areas

StayO consists of four navigation contexts.

Public Website

Authentication

Owner Application

Tenant Application

Future

Admin Portal

Warden Portal

---

# Public Website Navigation

Desktop

Logo

Features

Pricing

About

Contact

Login

Manage Your Hostel (Primary CTA)

---

Mobile

Hamburger Menu

Logo

Features

Pricing

About

Contact

Login

Manage Your Hostel

---

Sticky Navigation

Desktop

Yes

Mobile

Yes

Navigation remains visible while scrolling.

---

# Authentication Navigation

Authentication screens intentionally hide all dashboard navigation.

Visible Components

Logo

Back Button

Support Link

Language Selector (Future)

No Sidebar

No Top Navigation

No Footer Links

---

# Owner Application Layout

Desktop Layout

------------------------------------------------

Sidebar

|

Top Navigation

|

Main Content

|

------------------------------------------------

Sidebar remains fixed.

Top navigation remains fixed.

Content scrolls independently.

---

# Sidebar Navigation

Dashboard

Rooms

Tenants

Payments

Food

Complaints

Reports

Notifications

Settings

Logout

---

Navigation Order

Dashboard

↓

Rooms

↓

Tenants

↓

Payments

↓

Food

↓

Complaints

↓

Reports

↓

Notifications

↓

Settings

The order should never change.

---

Sidebar Behavior

Desktop

Expanded by default.

Collapsible.

Collapsed width:

Icons only.

Expanded width:

Icons + Labels.

---

Tablet

Collapsed by default.

Expandable.

---

Mobile

Hidden.

Accessible through drawer.

---

Sidebar Footer

Owner Profile

Hostel Name

Subscription Status

Logout

---

Top Navigation

Left

Breadcrumb

Current Page

Center

Search

Right

Notifications

Profile Avatar

Quick Actions

---

Global Search

Accessible from every owner screen.

Search should return:

Rooms

Tenants

Complaints

Payments

Reports

Food Polls

Settings

Future:

Command Palette

Keyboard Shortcut

CMD + K

CTRL + K

---

Quick Actions

Desktop

Floating Create Button

Options

Create Room

Invite Tenant

Create Food Poll

Record Payment

Create Complaint

---

Notifications

Unread Badge

Notification Drawer

Categories

Payments

Complaints

Food

Announcements

System

---

Profile Menu

Owner Information

Edit Profile

Settings

Help

Logout

---

Breadcrumbs

Dashboard

>

Rooms

>

Room Details

Example

Dashboard

>

Tenants

>

Rahul Sharma

Every child page should display breadcrumbs.

---

Owner Navigation Permissions

Dashboard

✓

Rooms

✓

Tenants

✓

Payments

✓

Food

✓

Complaints

✓

Reports

✓

Settings

✓

Admin Screens

✘

Tenant Screens

✘

---

# Tenant Navigation

Desktop

Sidebar

Top Navigation

Main Content

---

Sidebar

Dashboard

Payments

Food

Complaints

Notifications

Profile

---

Mobile Navigation

Bottom Navigation

Dashboard

Payments

Food

Complaints

Profile

Maximum

Five navigation items.

Additional screens open normally.

---

Tenant Search

Not available in Version 1.

---

Tenant Breadcrumbs

Desktop Only.

Hidden on Mobile.

---

# Navigation Guards

Unauthenticated User

Attempt

Dashboard

↓

Redirect Login

---

Owner

Attempts Tenant Dashboard

↓

403

Access Denied

---

Tenant

Attempts Owner Dashboard

↓

403

Access Denied

---

Expired Session

Redirect

Login

Preserve intended destination.

---

# Active Navigation States

Current Page

Highlighted

Expanded

Parent menu automatically expands.

Icons remain highlighted.

---

Hover States

Desktop Only.

Cursor

Pointer

Highlight Background

Tooltip when sidebar collapsed.

---

Loading Navigation

Show skeleton sidebar.

Preserve layout.

Avoid layout shifts.

---

Responsive Breakpoints

Desktop

≥ 1280px

Sidebar Expanded

---

Laptop

1024px – 1279px

Collapsible Sidebar

---

Tablet

768px – 1023px

Drawer Navigation

---

Mobile

<768px

Bottom Navigation

Drawer Menu

---

Navigation Animations

Sidebar Expand

200ms

Drawer

250ms

Dropdown

150ms

Page Transition

200ms

Animations should feel smooth but never slow.

---

Accessibility

Keyboard Navigation

Required

Focus Indicators

Required

ARIA Labels

Required

Screen Reader Support

Required

Minimum Touch Target

44px

Color should never be the only indication of active state.

---

Future Navigation

Admin Sidebar

Dashboard

Owners

Subscriptions

Support

Analytics

Settings

---

Warden Sidebar

Dashboard

Residents

Complaints

Food

Attendance

Rooms

Notifications

These menus are placeholders for future implementation.

---

Navigation Principles Summary

✓ Predictable

✓ Mobile-first

✓ Role-based

✓ Accessible

✓ Consistent

✓ Fast

✓ Scalable

This document is the single source of truth for all navigation behavior in StayO.