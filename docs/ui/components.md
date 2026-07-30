# Components
# StayO Component Library Specification

Version: 1.0
Status: Active
Last Updated: July 2026

---

# Purpose

This document defines every reusable UI component used throughout StayO Version 1.

The objective is to create a consistent design language across the entire application while minimizing duplicate implementations.

Every screen in StayO should be built by composing reusable components instead of creating page-specific UI.

This document defines:

• Component purpose

• Usage guidelines

• Variants

• States

• Accessibility

• Responsive behavior

• Interaction rules

---

# Component Design Principles

Every component must satisfy these principles.

## Consistency

A component should behave identically everywhere.

Example:

A primary button always looks and behaves the same regardless of page.

---

## Reusability

Components should solve generic problems.

Never build a "Room Button."

Build a generic Button.

---

## Accessibility

All interactive components must support:

Keyboard navigation

ARIA labels

Focus indicators

Screen readers

Proper color contrast

---

## Mobile First

Every component should work naturally on mobile before desktop.

---

## Performance

Components should avoid unnecessary re-renders.

Support lazy loading where appropriate.

---

# Component Categories

StayO components are divided into the following groups.

1. Inputs

2. Buttons

3. Cards

4. Navigation

5. Data Display

6. Feedback

7. Overlays

8. Charts

9. Tables

10. Layout

11. Utilities

---

# Buttons

Purpose

Trigger user actions.

Variants

Primary

Secondary

Ghost

Outline

Text

Danger

Success

Icon Button

FAB (Floating Action Button)

States

Default

Hover

Pressed

Focused

Loading

Disabled

Success

Error

Rules

One Primary CTA per section.

Avoid multiple competing primary buttons.

---

# Inputs

Text Input

Email Input

Phone Input

Password Input

OTP Input

Search Input

Number Input

Currency Input

Date Input

Time Input

Textarea

Validation

Required

Optional

Read Only

Disabled

Error

Success

Loading

Accessibility

Label required

Placeholder optional

Helper text supported

Error message supported

---

# Select Components

Dropdown

Multi Select

Autocomplete

Searchable Select

Country Selector

City Selector

Room Selector

Tenant Selector

States

Empty

Loading

Disabled

Selected

---

# Checkbox

Variants

Single

Group

Indeterminate

States

Checked

Unchecked

Disabled

Focused

---

# Radio Button

Purpose

Single selection.

States

Checked

Unchecked

Disabled

---

# Switch

Purpose

Enable or disable settings.

Example

Notifications

Dark Mode (Future)

SMS Alerts

---

# Date Components

Date Picker

Range Picker

Calendar

Month Picker

Week Picker

Time Picker

---

# Cards

Metric Card

Information Card

Profile Card

Room Card

Tenant Card

Payment Card

Complaint Card

Food Card

Announcement Card

Card Structure

Header

Body

Footer

Actions

---

# KPI Cards

Displays

Title

Value

Trend

Comparison

Icon

Click Action

Example

Monthly Revenue

Occupied Beds

Pending Payments

Collection Rate

---

# Tables

Purpose

Display structured data.

Features

Sorting

Filtering

Pagination

Search

Column Resize

Responsive Collapse

Bulk Actions

Export

Loading State

Empty State

---

# Lists

Simple List

Grouped List

Timeline

Activity Feed

Notification List

---

# Badges

Variants

Success

Warning

Error

Info

Neutral

Example

Paid

Pending

Occupied

Vacant

Resolved

Open

---

# Chips

Interactive

Filter

Selection

Status

---

# Avatar

Single

Group

Initial

Image

Fallback

Sizes

Small

Medium

Large

Extra Large

---

# Navigation Components

Sidebar

Top Bar

Bottom Navigation

Breadcrumb

Tabs

Menu

Dropdown

Pagination

Command Palette (Future)

---

# Search

Global Search

Table Search

Tenant Search

Room Search

Filters

Debounced Input

Recent Searches (Future)

---

# Modals

Confirmation

Delete

Success

Error

Image Preview

Payment Details

Complaint Details

Rules

Never stack multiple modals.

Escape closes modal.

Focus trapped.

---

# Drawers

Notification Drawer

Room Drawer

Tenant Drawer

Payment Drawer

Complaint Drawer

Responsive

Desktop

Side Drawer

Mobile

Bottom Sheet

---

# Sheets

Create Room

Invite Tenant

Record Payment

Create Poll

Publish Menu

Settings

---

# Tabs

Owner Profile

Tenant Profile

Reports

Payments

Food

Complaint Details

Rules

Maximum 7 visible tabs.

---

# Accordion

Used for

FAQs

Hostel Rules

Advanced Settings

---

# Timeline

Complaint History

Payment History

Activity Feed

Room Transfers

---

# Calendar

Food Schedule

Due Dates

Occupancy Calendar

Reports

---

# Charts

Line Chart

Bar Chart

Area Chart

Pie Chart

Donut Chart

Progress Ring

Sparkline

Usage

Revenue

Occupancy

Food Polls

Complaints

Payments

---

# Empty States

No Rooms

No Tenants

No Complaints

No Payments

No Reports

No Notifications

Every empty state must contain:

Illustration

Message

Description

Primary CTA

---

# Loading Components

Skeleton Card

Skeleton Table

Skeleton Chart

Loading Button

Spinner

Progress Bar

Shimmer

---

# Error Components

Inline Error

Full Page Error

Toast Error

Retry Card

Permission Error

Offline Screen

---

# Toast Notifications

Success

Warning

Error

Information

Rules

Top Right (Desktop)

Bottom (Mobile)

Auto dismiss

Manual close

---

# File Upload

Single File

Multiple Files

Image Upload

Document Upload

Drag & Drop

Progress

Preview

Remove

Retry

---

# Image Components

Avatar

Gallery

Lightbox

Thumbnail

Preview

Lazy Loading

---

# Forms

Multi Step Form

Inline Form

Modal Form

Drawer Form

Validation

Real Time

On Submit

Server Side

---

# Layout Components

Container

Section

Grid

Stack

Divider

Spacer

Surface

Panel

---

# Utility Components

Tooltip

Popover

Help Text

Copy Button

QR Code

Status Indicator

Progress Ring

Countdown

Tag

---

# Accessibility Requirements

Keyboard Accessible

Focus Visible

Screen Reader Support

ARIA Labels

Touch Targets ≥44px

Color Contrast WCAG AA

Semantic HTML

---

# Responsive Rules

Desktop

Full feature set.

Tablet

Compact layout.

Mobile

Cards replace large tables.

Touch optimized.

Bottom sheets preferred.

---

# Component Naming Convention

Components should follow a consistent naming strategy.

Examples

Button

Input

DataTable

MetricCard

RoomCard

TenantCard

PaymentTable

ComplaintTimeline

FoodCalendar

Avoid page-specific names.

---

# Future Components

AI Assistant

Command Palette

Voice Search

Analytics Widgets

Smart Suggestions

These components are outside Version 1.

---

# Component Governance

Every new reusable component must:

Have a documented purpose.

Support loading state.

Support empty state (if applicable).

Support error state (if applicable).

Meet accessibility requirements.

Be responsive.

Be reusable.

Be reviewed before inclusion in the shared component library.

---

This document is the single source of truth for all reusable UI components in StayO. No component should be introduced into the application without being defined or justified here.