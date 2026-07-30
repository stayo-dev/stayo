# Mobile Guidelines
# StayO Mobile Design Guidelines

Version: 1.0

Status: Active

Last Updated: July 2026

---

# Purpose

StayO is designed as a mobile-first platform.

Although desktop and tablet interfaces are supported, the primary experience is optimized for smartphone users.

Most hostel owners and tenants interact with StayO using Android devices throughout the day.

This document defines the standards for designing responsive, consistent, and intuitive mobile experiences.

These guidelines apply to all current and future screens.

---

# Mobile First Philosophy

Every new feature must be designed for mobile before desktop.

Design order:

Mobile

↓

Tablet

↓

Desktop

Never design a desktop screen first and shrink it to fit mobile.

---

# Supported Devices

Primary Devices

Android Phones

Secondary Devices

iPhone

Tablets

Desktop Browsers

Minimum Width

320 px

Recommended Design Width

390 px

Maximum Mobile Width

480 px

Tablet

768 px

Desktop

1280 px+

---

# Screen Principles

Every screen should answer three questions immediately:

1. Where am I?

2. What can I do here?

3. What should I do next?

The primary action should always be obvious.

---

# Navigation

Public Pages

Top Navigation

Owner Dashboard

Bottom Navigation

Tenant Dashboard

Bottom Navigation

Admin Dashboard

Sidebar (Desktop)

Drawer (Mobile)

Avoid more than five primary navigation items.

---

# Touch Targets

Minimum touch area

48 × 48 px

Preferred

56 × 56 px

Buttons should never be difficult to tap.

Interactive elements should include sufficient spacing to prevent accidental touches.

---

# Safe Areas

All screens must respect:

Status Bar

Camera Notch

Bottom Gesture Area

Rounded Corners

No important controls should be placed within unsafe regions.

---

# Typography

Use a consistent type scale.

Display

32 px

Page Title

24 px

Section Title

20 px

Card Title

18 px

Body

16 px

Secondary Text

14 px

Caption

12 px

Avoid font sizes below 12 px.

---

# Spacing System

Base Unit

8 px

Spacing Scale

4

8

12

16

20

24

32

40

48

64

All layouts should follow this spacing system.

Avoid arbitrary values.

---

# Cards

Cards are the primary layout container.

Each card should contain:

Title

Supporting Information

Primary Action

Optional Secondary Action

Cards should have consistent padding and border radius.

---

# Buttons

Primary Button

Filled

Main Action

Examples

Save

Continue

Create

Publish

---

Secondary Button

Outlined

Used for optional actions.

---

Text Button

Low emphasis.

Used for navigation and secondary tasks.

---

Danger Button

Reserved for destructive actions.

Delete

Remove

Deactivate

Require confirmation before execution.

---

# Forms

Forms should be divided into logical sections.

Each section should focus on one task.

Examples

Personal Details

Hostel Information

Room Details

Payment Details

Avoid long forms whenever possible.

Use progressive steps for onboarding.

---

# Input Fields

Every input must include:

Label

Placeholder

Validation

Error Message

Helper Text (if needed)

Never rely on placeholders as labels.

---

# Bottom Sheets

Use bottom sheets for:

Quick actions

Filters

Small forms

Selection lists

Confirmation dialogs

Avoid full-screen dialogs unless necessary.

---

# Modals

Use modals only for:

Critical confirmation

Delete confirmation

Payment confirmation

Sensitive actions

Most interactions should use bottom sheets instead.

---

# Lists

Large datasets should use:

Search

Filtering

Sorting

Pagination or Infinite Scroll

Examples

Tenants

Payments

Complaints

Rooms

---

# Tables

Avoid complex tables on mobile.

Convert large tables into stacked cards.

Desktop may display tabular layouts.

---

# Empty States

Every empty screen should include:

Illustration or Icon

Clear Message

Explanation

Primary Action

Example

"No tenants have been added yet."

Button

Invite Tenant

---

# Loading States

Avoid blank screens.

Use:

Skeleton Loaders

Progress Indicators

Shimmer Effects

Preserve layout while loading.

---

# Error States

Every error should include:

Clear explanation

Recovery action

Retry button (when applicable)

Avoid technical error messages.

---

# Search

Search should appear at the top of data-heavy screens.

Examples

Tenants

Rooms

Payments

Complaints

Support partial matching.

Ignore capitalization.

---

# Filters

Use bottom sheets for mobile filters.

Common filters include:

Status

Date

Floor

Room

Payment State

Complaint Type

Meal Type

---

# Notifications

Notifications should be:

Short

Actionable

Grouped when possible

Include timestamps

Unread notifications should be visually distinct.

---

# Dashboard Guidelines

Dashboard should answer:

Current occupancy

Pending payments

Complaints

Revenue

Food updates

Recent activity

Most important metrics should appear first.

---

# Charts

Charts should prioritize readability.

Avoid excessive colors.

Support touch interaction.

Provide numerical summaries alongside charts.

---

# Performance

Target page load

< 2 seconds

Target interaction response

< 100 ms

Animations

200–300 ms

Avoid heavy animations that delay interaction.

---

# Accessibility

Minimum contrast ratio

WCAG AA

Interactive controls should support screen readers.

Use meaningful labels.

Avoid color-only indicators.

Support scalable text.

---

# Offline Handling

Version 1 requires internet connectivity.

If offline:

Display an offline banner.

Disable write operations.

Allow cached read-only content where possible.

---

# Responsive Breakpoints

Mobile

320–480 px

Tablet

768–1024 px

Desktop

1280 px+

Layouts should adapt without changing user workflows.

---

# Design Consistency

Every screen should maintain:

Consistent spacing

Consistent typography

Consistent button hierarchy

Consistent iconography

Consistent navigation

Consistent terminology

Users should never feel they have switched to a different product.

---

# Future Considerations

Future versions may include:

Dark Mode

Tablet Optimization

Offline Sync

Landscape Layouts

Foldable Device Support

Desktop Productivity Mode

The design system should be flexible enough to support these enhancements.

---

# Summary

StayO follows a mobile-first design philosophy focused on speed, clarity, and operational efficiency.

Every interface should minimize user effort, prioritize the most important actions, and provide a consistent experience across all devices while maintaining a clean and modern design language.