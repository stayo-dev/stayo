# User Flows
# StayO User Flows

Version: 1.0
Status: Active
Last Updated: July 2026

---

# Purpose

This document defines every user journey supported in StayO Version 1.

Unlike the sitemap, which describes where screens exist, this document explains how users move between those screens, what actions they perform, what validations occur, what APIs are triggered, and what the expected outcomes are.

Every feature implemented in the frontend should follow one of the user flows defined in this document.

---

# User Roles

Version 1 supports the following roles.

• Visitor

• Owner

• Tenant

• Internal Admin

---

# Primary Product Flow

The core business flow of StayO Version 1 is shown below.

Visitor

↓

Landing Page

↓

Clicks "Manage Your Hostel"

↓

Lead Registration

↓

Lead Created

↓

Internal Team Contacts Owner

↓

Pricing Discussion

↓

Owner Approval

↓

Activation Link Sent

↓

Owner Onboarding

↓

Hostel Setup

↓

Owner Dashboard

↓

Owner Invites Tenant

↓

Tenant Activation

↓

Tenant Dashboard

This flow represents the complete onboarding lifecycle of Version 1.

---

# Flow 1 — Owner Acquisition

## Objective

Convert a visitor into a registered hostel owner.

### Entry Point

Landing Page

### Trigger

Visitor clicks:

Manage Your Hostel

### User Inputs

Owner Name

Phone Number

Email Address

Hostel Name

City

### Validation

Phone Number must be valid.

Email format must be valid.

Required fields cannot be empty.

### System Action

Create Lead

Store lead information

Notify internal team

Display confirmation message

### Success State

Lead successfully created.

Owner is informed that the StayO team will contact them shortly.

### Failure States

Network Error

Duplicate Lead

Server Error

Validation Failure

---

# Flow 2 — Owner Verification

Version 1 uses manual verification.

Steps

Lead Reviewed

↓

Internal Team Calls Owner

↓

Pricing Finalized

↓

Owner Approved

↓

Activation Link Generated

↓

Activation Link Sent

↓

Owner Clicks Link

↓

Owner Onboarding Starts

---

# Flow 3 — Owner Onboarding

Objective

Configure the hostel for first-time use.

## Step 1

Personal Details

Fields

Owner Name

Email

Phone

Alternate Contact

Profile Image (Optional)

Validation

Required fields

Valid phone

Valid email

---

## Step 2

Hostel Information

Hostel Name

Address

City

State

Pincode

Hostel Type

Description

Amenities

---

## Step 3

Building Structure

Number of Floors

Rooms per Floor

Room Types

Capacity

Bed Configuration

---

## Step 4

Business Configuration

Rent Cycle

Security Deposit

Payment Due Date

Hostel Rules

Emergency Contact

---

## Step 5

Review

Display all entered information.

Owner confirms.

Hostel is created.

Dashboard opens.

---

# Flow 4 — Owner Dashboard

Landing Page

↓

Dashboard

↓

Owner selects module

↓

Module opens

↓

Action performed

↓

Backend updated

↓

Dashboard refreshed

Supported Modules

Dashboard

Rooms

Tenants

Payments

Food

Complaints

Reports

Notifications

Settings

---

# Flow 5 — Room Management

Owner

↓

Rooms

↓

Create Room

↓

Enter Details

↓

Save

↓

Room Created

Room Details

Room Number

Floor

Capacity

Room Type

Status

Notes

Actions

Create

Edit

Delete

View

Assign Tenant

Vacate Tenant

Transfer Tenant

---

# Flow 6 — Tenant Invitation

Owner

↓

Tenant Module

↓

Invite Tenant

↓

Generate Invitation Link

↓

Share Link

↓

Tenant Opens Link

↓

Tenant Completes Registration

↓

Tenant Account Activated

↓

Tenant Dashboard Opens

Validation

Invitation not expired

Invitation belongs to hostel

Invitation unused

---

# Flow 7 — Tenant Login

Tenant

↓

Invitation Link

↓

OTP Verification

↓

Profile Completion

↓

Dashboard

If account already exists

↓

Login

↓

Dashboard

---

# Flow 8 — Payment Management

Owner

↓

Payments

↓

Select Tenant

↓

View Payment History

↓

Record Payment

↓

Update Balance

↓

Dashboard Updated

Tenant

↓

Payments

↓

View Outstanding Balance

↓

View History

↓

Download Receipt (Future)

---

# Flow 9 — Complaint Management

Tenant

↓

Complaints

↓

Create Complaint

↓

Select Category

↓

Description

↓

Upload Images (Optional)

↓

Submit

↓

Complaint Created

Owner

↓

Receives Notification

↓

Views Complaint

↓

Assign Status

↓

Resolve

↓

Close Complaint

Statuses

Open

Assigned

In Progress

Resolved

Closed

---

# Flow 10 — Food Management

Owner

↓

Food Module

↓

Create Poll

↓

Publish Poll

↓

Tenants Vote

↓

Poll Ends

↓

Results Calculated

↓

Owner Reviews Results

↓

Final Menu Published

↓

Schedule Visible To Tenants

---

# Flow 11 — Food Schedule

Owner

↓

Food Calendar

↓

Create Weekly Menu

↓

Create Monthly Menu

↓

Publish

↓

Tenants View Menu

Tenants cannot edit schedules.

---

# Flow 12 — Notifications

Trigger Sources

Payment Due

Complaint Update

Food Poll

Food Schedule

Announcements

System Messages

Notification Delivery

Dashboard

Email

WhatsApp (Future)

Push Notifications (Future)

---

# Flow 13 — Reports

Owner

↓

Reports

↓

Select Report

↓

Choose Date Range

↓

Generate

↓

Display Charts

↓

Export (Future)

Available Reports

Revenue

Occupancy

Payments

Food Participation

Complaints

Monthly Summary

---

# Flow 14 — Settings

Owner

↓

Settings

↓

Profile

↓

Hostel Configuration

↓

Notification Preferences

↓

Password

↓

Save

↓

Changes Applied

---

# Exception Flows

Invalid Invitation

↓

Show Error

↓

Contact Owner

---

Expired Activation Link

↓

Show Expired Screen

↓

Request New Activation

---

Owner Leaves Onboarding Midway

↓

Progress Saved

↓

Resume Later

---

Network Failure

↓

Retry

↓

Restore Previous State

---

Unauthorized Access

↓

Redirect Login

↓

Display Permission Error

---

# Permissions Matrix

Visitor

Landing

Registration

Contact

Owner

Dashboard

Rooms

Tenants

Payments

Food

Complaints

Reports

Settings

Tenant

Dashboard

Payments

Food

Complaints

Profile

Notifications

Admin

Lead Management

Owner Approval

Support

---

# Future Flows (Version 2)

Hostel Discovery

Public Search

Booking

Online Payments

Marketplace

Reviews

Referral System

AI Assistant

Multi-owner Management

These flows are intentionally excluded from Version 1.