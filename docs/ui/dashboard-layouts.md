# Dashboard Layouts
# StayO Dashboard Layout Specification

Version: 1.0

Status: Active

Last Updated: July 2026

---

# Purpose

This document defines the layout, hierarchy, components, widgets, interactions, responsive behavior, and user experience for every dashboard screen in StayO Version 1.

This document does NOT define colors or styling. Those belong in the Design System.

Instead, it defines:

• Page layouts

• Widget placement

• Information hierarchy

• User actions

• Tables

• Cards

• Charts

• Responsive behavior

• Empty states

• Loading states

• Error states

This document should be treated as the UI blueprint for implementation.

---

# Dashboard Design Principles

Every dashboard in StayO should follow these principles.

1. Information First

Most important information should always appear above the fold.

---

2. Reduce Clicks

Common actions should always be visible.

Avoid hiding frequent actions inside menus.

---

3. Consistency

Every page follows the same spacing, grid system, and component hierarchy.

---

4. Mobile First

Every dashboard must work perfectly on phones before desktop.

---

5. Action Driven

Users should always know what to do next.

Each page should expose clear actions.

---

# Global Dashboard Structure

Desktop Layout

------------------------------------------------------

Top Navigation

------------------------------------------------------

Sidebar | Main Content

Sidebar | Main Content

Sidebar | Main Content

------------------------------------------------------

Desktop

Sidebar Fixed

Top Bar Fixed

Content Scrollable

---

Tablet

Sidebar Drawer

Top Navigation

Content Full Width

---

Mobile

Bottom Navigation

Floating Action Button

Full Width Content

---

# Owner Dashboard

Purpose

Provide an operational overview of the hostel.

---

Sections

Welcome Header

Quick Stats

Financial Overview

Occupancy Overview

Recent Activity

Upcoming Tasks

Quick Actions

Announcements

---

Header

Displays

Owner Name

Hostel Name

Current Date

Greeting

Notification Icon

Profile Menu

---

Quick Statistics

Cards

Total Rooms

Occupied Beds

Vacant Beds

Active Tenants

Pending Payments

Open Complaints

Monthly Revenue

Collection Rate

Each KPI card should support:

Tooltip

Trend Indicator

Comparison with Previous Month

Click Action

---

Quick Actions

Buttons

Invite Tenant

Create Room

Record Payment

Create Food Poll

Add Announcement

Register Complaint

---

Recent Activity

Timeline

Recent Payments

New Tenant

Complaint Updates

Food Poll Created

Room Assigned

Activity should display timestamps.

---

Upcoming Tasks

Cards

Rent Due Today

Expiring Agreements

Pending Complaints

Food Poll Ending

---

Charts

Revenue

Monthly Occupancy

Payment Collection

Complaint Trends

Food Poll Participation

Charts should support:

Hover

Filtering

Date Range

---

Rooms Module

Purpose

Manage hostel rooms.

---

Layout

Header

Filters

Room Grid/Table

Room Details Drawer

Actions

---

Header

Displays

Room Count

Occupied

Vacant

Search

Create Room Button

---

Filters

Floor

Status

Capacity

Room Type

Availability

Search

---

Room Card

Displays

Room Number

Floor

Capacity

Occupied Beds

Status

Assigned Tenants

Quick Actions

---

Room Actions

View

Edit

Delete

Assign Tenant

Transfer Tenant

Vacate Room

---

Room Details

Displays

Room Information

Occupants

History

Payments

Complaints

Maintenance

---

Tenants Module

Purpose

Manage tenant lifecycle.

---

Header

Tenant Count

Search

Filters

Invite Tenant

Export

---

Tenant Table

Columns

Profile

Name

Phone

Room

Rent

Due Date

Status

Actions

---

Tenant Profile

Tabs

Overview

Payments

Complaints

Food

Documents

Activity

Settings

---

Quick Actions

Call

WhatsApp

Transfer

Deactivate

View Payments

---

Payments Module

Purpose

Track hostel revenue.

---

Dashboard

Revenue Cards

Payment Table

Due List

Collection Graph

---

KPIs

Collected

Pending

Overdue

Collection Rate

Revenue

---

Payment Table

Columns

Tenant

Room

Amount

Paid

Due

Status

Date

Actions

---

Actions

Record Payment

View Receipt

Payment History

Reminder

---

Food Module

Purpose

Manage hostel food operations.

---

Overview

Today's Menu

Weekly Menu

Monthly Menu

Food Poll

Templates

Analytics

---

Today's Menu

Breakfast

Lunch

Snacks

Dinner

Status

---

Poll Dashboard

Active Polls

Completed Polls

Upcoming Polls

Participation Rate

---

Food Schedule

Weekly Calendar

Monthly Calendar

Meal Cards

Templates

Publish Button

---

Food Feedback

Average Rating

Popular Meals

Least Preferred Meals

Suggestions

---

Complaints Module

Purpose

Track tenant issues.

---

Dashboard

Complaint Cards

Status Distribution

Priority Distribution

Timeline

---

Complaint Table

Columns

Complaint ID

Tenant

Category

Priority

Status

Assigned

Created

Actions

---

Complaint Details

Description

Images

Timeline

Conversation

Resolution Notes

---

Reports Module

Purpose

Provide business insights.

---

Reports

Revenue

Occupancy

Food

Complaints

Tenants

Payments

---

Each Report

Filters

Date Range

Export

Charts

Tables

KPIs

Summary

---

Notifications

Purpose

Central communication hub.

---

Sections

Unread

Announcements

Payments

Food

Complaints

System

---

Settings

Purpose

Configure hostel.

---

Sections

Profile

Hostel Details

Rooms

Notifications

Security

Subscription

---

Tenant Dashboard

Purpose

Provide tenants with all daily hostel information.

---

Overview

Current Room

Today's Menu

Outstanding Balance

Open Complaints

Announcements

Quick Links

---

Payments

Outstanding

History

Status

Transactions

---

Food

Today's Meals

Weekly Menu

Monthly Menu

Vote

Feedback

---

Complaints

Create Complaint

Track Complaint

History

Images

Status

---

Notifications

Announcements

Updates

Alerts

Food

Payments

---

Profile

Personal Information

Emergency Contact

Documents

Password

Preferences

---

Common Dashboard Components

Every dashboard may use:

Metric Cards

Tables

Charts

Timeline

Calendar

Search

Filters

Badges

Status Chips

Pagination

Drawer

Modal

Sheet

Tabs

Accordion

Breadcrumb

Toast

---

Loading States

Every screen must include:

Skeleton Cards

Skeleton Tables

Skeleton Charts

Loading Buttons

Progress Indicators

---

Empty States

No Rooms

No Tenants

No Complaints

No Payments

No Reports

No Notifications

No Polls

Each empty state should provide a primary action.

---

Error States

API Failure

Network Failure

Permission Error

404

500

Retry Button

Support Link

---

Responsive Rules

Desktop

Maximum information density.

---

Tablet

Reduce columns.

Collapse filters.

---

Mobile

Single column.

Cards replace tables.

Bottom navigation.

Floating action button.

Touch targets minimum 44px.

---

Accessibility

Keyboard Navigation

Screen Reader Support

High Contrast

ARIA Labels

Focus Indicators

Responsive Typography

---

Performance Guidelines

Lazy Loading

Pagination

Virtualized Tables

Optimized Charts

Progressive Loading

Optimistic Updates

Caching

---

Future Layouts

Admin Dashboard

Design Pending

Implementation Pending

---

Warden Dashboard

Design Pending

Implementation Pending

---

This document defines the structural blueprint for every dashboard in StayO Version 1. Any new dashboard screen should follow the layout hierarchy, component patterns, and interaction rules described here.