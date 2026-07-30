# Frontend Architecture
# StayO Frontend Architecture

Version: 1.0
Status: Active
Last Updated: July 2026

---

# Purpose

This document defines the frontend architecture for StayO Version 1.

It serves as the engineering blueprint for building the new frontend while reusing the existing backend.

The objective is to create a scalable, maintainable, and modular frontend that supports future product growth without major architectural changes.

This document covers:

• Folder structure

• Routing

• State management

• API architecture

• Authentication

• UI architecture

• Feature organization

• Coding standards

• Performance

• Security

---

# Engineering Principles

The frontend should follow these principles.

## 1. Feature First

Organize code around business features rather than file types.

Example

✓ Features/Rooms

✓ Features/Tenants

✗ Components1

✗ Components2

---

## 2. Reusable Before Custom

If a component can be reused, place it inside the shared component library.

Avoid duplicate implementations.

---

## 3. Single Responsibility

Each component should have one responsibility.

Avoid components that perform unrelated tasks.

---

## 4. Mobile First

Every screen is developed for mobile first.

Desktop layouts extend mobile behavior.

---

## 5. API Driven

Frontend should never contain business logic.

All calculations belong to backend services.

---

# Technology Stack

Framework

Next.js

Language

TypeScript

Styling

Tailwind CSS

UI Library

shadcn/ui

Icons

Lucide React

Forms

React Hook Form

Validation

Zod

State

TanStack Query + Zustand

Tables

TanStack Table

Charts

Recharts

Authentication

Supabase Auth

Package Manager

pnpm

---

# Project Structure

apps/
    frontend/
        app/
        components/
        features/
        hooks/
        lib/
        services/
        store/
        types/
        utils/
        styles/
        public/

---

# App Directory

Responsible for routing.

Contains

Layouts

Pages

Route Groups

Providers

Error Pages

Loading Pages

---

# Components

Contains reusable UI.

Example

Button

Input

Dialog

Table

Badge

Card

Avatar

Chart

Calendar

These components should never contain business logic.

---

# Features

Business modules.

Example

features/

dashboard/

rooms/

tenants/

payments/

food/

complaints/

reports/

settings/

Each feature contains

Components

Hooks

API

Types

Utilities

Constants

---

# Shared Library

Contains

Design Tokens

Constants

Utilities

Helpers

Shared Hooks

Shared Types

Shared Components

---

# Hooks

Reusable React hooks.

Examples

useAuth()

usePagination()

useDebounce()

useModal()

useSearch()

useToast()

---

# Services

API communication layer.

Structure

services/

api/

auth/

dashboard/

rooms/

tenants/

payments/

food/

complaints/

reports/

Every service wraps backend endpoints.

Components never call fetch directly.

---

# API Layer

Component

↓

Custom Hook

↓

Service

↓

HTTP Client

↓

Backend API

---

# HTTP Client

Single HTTP client.

Responsibilities

Authorization

Retry

Headers

Refresh Tokens

Interceptors

Logging

Error Mapping

Timeout

---

# State Management

Global State

Authentication

Theme (Future)

Notifications

User Profile

Hostel Context

Feature State

Handled by TanStack Query.

Avoid unnecessary global state.

---

# Server State

All backend data managed using TanStack Query.

Examples

Rooms

Tenants

Payments

Reports

Complaints

Benefits

Caching

Automatic Refetch

Optimistic Updates

Background Refresh

---

# Local State

Use React state for

Forms

Dialogs

Dropdowns

Selections

Temporary UI

Never use global state for local UI.

---

# Authentication

Login

↓

JWT

↓

Store Session

↓

Protected Routes

↓

Refresh Token

↓

Logout

---

Protected Routes

Owner Dashboard

Tenant Dashboard

Settings

Payments

Reports

Unauthenticated users redirected to Login.

---

# Authorization

Roles

Owner

Tenant

Future

Admin

Warden

Route access controlled at middleware and UI level.

---

# Routing

Public

/

features

pricing

contact

login

Owner

/dashboard

/rooms

/tenants

/payments

/food

/complaints

/reports

/settings

Tenant

/tenant/dashboard

/tenant/payments

/tenant/food

/tenant/complaints

/profile

---

# Layout System

Public Layout

Authentication Layout

Owner Dashboard Layout

Tenant Dashboard Layout

Error Layout

---

# Forms

React Hook Form

+

Zod

Features

Validation

Error Messages

Loading

Submit States

Accessibility

Reusable Form Components

---

# Error Handling

Every page should support

Loading

Empty

Error

Success

Offline

Permission Denied

404

500

---

# Notifications

Toast

Banner

Dialog

Inline Validation

Success Messages

---

# File Upload

Supported

Images

Documents

Avatar

Complaint Images

Future

CSV Import

Excel Import

---

# Search

Debounced

300ms

Global Search

Server Search

Table Search

Client Search

---

# Tables

Use TanStack Table.

Features

Sorting

Filtering

Pagination

Responsive Layout

Selection

Bulk Actions

---

# Charts

Use Recharts.

Supported

Bar

Line

Area

Pie

Donut

Progress

Charts should never block rendering.

---

# Styling

Tailwind CSS

Use design tokens.

Avoid inline styles.

Avoid custom CSS unless necessary.

---

# Icons

Lucide only.

No mixed icon libraries.

---

# Images

Next Image

Lazy Loading

Responsive

Optimized

---

# Accessibility

Keyboard Navigation

Screen Reader

ARIA Labels

Semantic HTML

Focus States

Minimum Touch Size 44px

WCAG AA

---

# Performance

Lazy Loading

Dynamic Imports

Image Optimization

Code Splitting

Memoization

Virtual Lists

Pagination

Prefetching

Optimistic UI

---

# Security

Escape HTML

Validate Forms

Never expose secrets

Protect Routes

Validate API Responses

Sanitize Inputs

---

# Environment Variables

Public

NEXT_PUBLIC_*

Private

Server Only

Never expose Service Role Keys.

---

# Logging

Development

Console

Production

Structured Logging

Error Monitoring

Analytics

---

# Testing Strategy

Unit Tests

Component Tests

Integration Tests

End-to-End Tests

Visual Regression

Accessibility Tests

---

# Coding Standards

TypeScript Strict Mode

ESLint

Prettier

Absolute Imports

Named Exports

Small Components

Reusable Logic

Meaningful File Names

---

# Naming Conventions

Components

PascalCase

Hooks

camelCase

Files

kebab-case

Constants

UPPER_CASE

Types

PascalCase

---

# Git Workflow

feature/

fix/

refactor/

docs/

chore/

Small pull requests.

Code reviews mandatory.

---

# Deployment

Frontend

Vercel

Backend

Existing Deployment

Database

Supabase

Storage

Supabase Storage

---

# Future Scalability

Internationalization

Dark Mode

Offline Support

PWA

AI Assistant

Multi Hostel

Manager Dashboard

Admin Dashboard

---

# Architecture Summary

The StayO frontend should be:

✓ Modular

✓ Feature-based

✓ Mobile-first

✓ Type-safe

✓ Accessible

✓ Performant

✓ API-driven

✓ Easy to scale

This architecture serves as the engineering foundation for every frontend implementation in StayO Version 1.