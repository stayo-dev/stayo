# Sitemap
# StayO Application Sitemap

Version: 1.0

Status: Active

Last Updated: July 2026

---

# Purpose

This document defines the complete screen hierarchy of the StayO frontend.

Unlike the User Flows document, which explains how users navigate through the application, this document defines every page, screen, modal, drawer, dialog, sheet, and layout that exists in the product.

Every UI implementation should reference this document before creating new screens.

---

# Application Structure

StayO Version 1 consists of four major application areas.

1. Public Website

2. Authentication

3. Owner Application

4. Tenant Application

Future applications:

• Admin Portal

• Warden Portal

---

# Public Website

/

Landing Page

Purpose

Introduce StayO and convert visitors into owners.

Sections

Hero

Features

Benefits

Product Showcase

Testimonials

Pricing

FAQs

Contact

Footer

Primary CTA

Manage Your Hostel

Secondary CTA

Book Your Stay (Reserved for Version 2)

---

/about

About StayO

Sections

Mission

Vision

Story

Why StayO

---

/pricing

Pricing Plans

Platform Fee

Enterprise Contact

FAQs

---

/features

Owner Features

Tenant Features

Reports

Food

Payments

Complaints

Automation

---

/contact

Contact Form

Email

Phone

Office Address

---

/privacy

Privacy Policy

---

/terms

Terms & Conditions

---

# Authentication

/login

Owner Login

Tenant Login

Forgot Password

OTP Login

---

/activate

Owner Activation

Tenant Activation

---

/onboarding

Owner Onboarding Wizard

Steps

Personal Details

Hostel Information

Rooms

Business Settings

Review

Finish

---

# Owner Application

Layout

Sidebar

Top Navigation

Content Area

Notification Panel

Profile Menu

---

Dashboard

/

Purpose

Operational overview.

Widgets

Revenue

Occupancy

Pending Payments

Complaints

Recent Activity

Upcoming Dues

Announcements

Quick Actions

---

Rooms

/rooms

Room List

Room Cards

Filters

Search

Pagination

Actions

Create Room

Edit Room

Delete Room

Assign Tenant

Vacate

Transfer

---

Room Details

/rooms/:id

Room Information

Occupancy

Beds

Assigned Tenants

History

Activity

---

Tenants

/tenants

Tenant List

Filters

Search

Actions

Invite

Edit

Deactivate

Transfer

---

Tenant Details

/tenants/:id

Profile

Payments

Complaints

Room

Documents

Activity

---

Payments

/payments

Payment List

Outstanding Dues

Paid

Overdue

Filters

Actions

Record Payment

View History

Generate Receipt (Future)

---

Food

/food

Overview

Current Menu

Weekly Schedule

Monthly Schedule

Food Polls

Templates

Feedback

---

Food Poll

/food/polls

Poll List

Create Poll

Results

Votes

Status

---

Food Schedule

/food/schedule

Calendar

Weekly

Monthly

Publish

Archive

---

Complaints

/complaints

Complaint List

Filters

Priority

Status

Actions

Assign

Resolve

Close

---

Complaint Details

/complaints/:id

Timeline

Images

Conversation

Status History

---

Reports

/reports

Revenue

Occupancy

Payments

Food Analytics

Complaint Analytics

Exports (Future)

---

Notifications

/notifications

Unread

Read

Announcements

System Messages

---

Settings

/settings

Profile

Hostel

Rooms Configuration

Notification Preferences

Security

Subscription

---

# Tenant Application

Layout

Bottom Navigation (Mobile)

Sidebar (Desktop)

---

Dashboard

Overview

Current Room

Outstanding Payment

Today's Food

Recent Notifications

Open Complaints

---

Room

Room Information

Roommates

Amenities

Hostel Rules

---

Payments

Current Due

History

Receipts

---

Food

Today's Menu

Weekly Menu

Monthly Menu

Vote

Feedback

---

Complaints

Create Complaint

Track Complaint

History

---

Notifications

Announcements

Updates

Alerts

---

Profile

Personal Details

Emergency Contact

Documents

Password

---

# Global Components

Available Across Entire Application

Search

Notifications

Profile Menu

Theme Switcher (Future)

Help

Support

---

# Global Modals

Confirmation Dialog

Delete Confirmation

Success Dialog

Error Dialog

Loading Dialog

Image Preview

File Upload

QR Viewer

---

# Drawers

Notification Drawer

Profile Drawer

Filters Drawer

Room Details Drawer

Tenant Details Drawer

---

# Sheets

Create Room

Invite Tenant

Create Complaint

Record Payment

Create Food Poll

Publish Schedule

---

# Empty States

No Rooms

No Tenants

No Payments

No Complaints

No Polls

No Reports

No Notifications

---

# Error Screens

404

500

Unauthorized

Forbidden

Offline

Maintenance

---

# Loading States

Page Loading

Table Loading

Card Loading

Dashboard Skeleton

Chart Skeleton

Form Loading

---

# Future Applications

Admin Portal

Design Planned

Implementation Pending

---

Warden Portal

Design Planned

Implementation Pending

---

# Version 2 Screens

Hostel Discovery

Hostel Details

Room Booking

Availability Calendar

Reviews

Wishlist

Marketplace

Online Payments

AI Assistant

These screens are intentionally excluded from Version 1.