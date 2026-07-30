# Design System
# StayO Design System

Version: 1.0
Status: Active
Last Updated: July 2026

---

# Purpose

The StayO Design System establishes a single visual language for every interface across the product.

Its purpose is to ensure that every screen, interaction, and component feels consistent regardless of who designs or develops it.

This document defines the visual identity, interaction principles, spacing system, typography, color tokens, accessibility standards, motion language, responsive behavior, and reusable design foundations.

The design system is mandatory for every new screen, component, and feature built in StayO.

---

# Design Philosophy

StayO is not an ERP.

StayO is not accounting software.

StayO is not a government portal.

StayO should feel like a premium SaaS product.

The experience should be:

• Modern

• Clean

• Professional

• Friendly

• Fast

• Calm

• Mobile-first

Users should immediately understand where they are and what to do next.

---

# Design Principles

## 1. Simplicity

Every screen should solve one primary problem.

Avoid unnecessary information.

Reduce visual clutter.

---

## 2. Consistency

Buttons behave consistently.

Forms behave consistently.

Tables behave consistently.

Navigation behaves consistently.

Users should never have to relearn interactions.

---

## 3. Information Hierarchy

Important information appears first.

Critical actions receive visual emphasis.

Secondary information remains available but less prominent.

---

## 4. Mobile First

Every screen is designed for phones first.

Desktop layouts are extensions of the mobile experience.

---

## 5. Accessibility

The interface must remain usable for everyone.

Support:

Keyboard navigation

Screen readers

Focus states

High contrast

Large touch targets

---

# Brand Personality

StayO should communicate:

Trust

Reliability

Efficiency

Transparency

Professionalism

The interface should avoid looking playful or childish.

---

# Visual Style

Modern SaaS

Minimal

Rounded corners

Generous spacing

Soft shadows

Subtle animations

Limited color palette

High readability

---

# Color System

Primary

Used for:

Primary buttons

Links

Highlights

Charts

Selected states

---

Secondary

Used for:

Secondary actions

Supporting UI

Inactive controls

---

Success

Payments received

Completed tasks

Resolved complaints

---

Warning

Pending actions

Rent due

Expiring agreements

---

Danger

Delete

Errors

Critical alerts

---

Info

Announcements

Tips

Notifications

---

Neutral

Borders

Dividers

Cards

Backgrounds

Disabled controls

---

Background Layers

App Background

Surface

Card

Elevated Surface

Modal

---

Typography

Primary Font

Modern sans-serif

Examples

Inter

Geist

Manrope

Use a single type family throughout the product.

---

Typography Scale

Display

Page Title

Section Heading

Card Title

Body

Small

Caption

Overline

Monospace

Used only for:

IDs

Codes

Technical values

---

Typography Rules

Maximum three font weights.

Avoid excessive bold text.

Avoid centered body text.

Use sentence case.

---

Spacing System

Adopt an 8-point grid.

Examples

4

8

16

24

32

40

48

64

80

96

Spacing should always follow this scale.

Avoid arbitrary values.

---

Border Radius

Small

Buttons

Inputs

Medium

Cards

Dropdowns

Large

Dialogs

Sheets

Extra Large

Hero sections

Never mix multiple radius styles on the same page.

---

Elevation

Four elevation levels only.

Level 0

Flat

Level 1

Cards

Level 2

Dropdowns

Level 3

Dialogs

Level 4

Critical overlays

Avoid heavy shadows.

---

Icons

Use one icon family.

Examples

Lucide

Heroicons

Material Symbols

Never mix icon packs.

Icons communicate actions, not decoration.

---

Illustrations

Minimal

Vector

Friendly

Consistent

Use illustrations only for:

Empty states

Onboarding

Error pages

Success screens

---

Photography

Only used on:

Landing page

Marketing website

Never inside operational dashboards.

---

Buttons

Primary

One per section.

Secondary

Supporting actions.

Ghost

Toolbar actions.

Danger

Delete.

Icon

Compact actions.

Floating Action Button

Mobile only.

---

Forms

Labels always visible.

Placeholder never replaces label.

Validation in real time where appropriate.

Show helper text when needed.

---

Inputs

Minimum height

44px

Clear validation

Consistent spacing

Optional helper text

Required indicators

---

Tables

Sticky headers

Sortable columns

Pagination

Search

Filters

Responsive behavior

Cards replace tables on mobile.

---

Cards

Consistent padding

Title

Content

Actions

Status

Optional footer

Cards should never exceed one primary purpose.

---

Charts

Use only where visual comparison adds value.

Supported:

Line

Bar

Area

Pie

Donut

Progress Ring

Avoid 3D charts.

---

Status Indicators

Success

Warning

Danger

Info

Neutral

Never rely on color alone.

Always include text or icons.

---

Navigation

Sidebar

Desktop

Bottom Navigation

Mobile

Top Bar

Global

Navigation must remain predictable.

---

Motion

Animations should support understanding.

Avoid decorative motion.

Recommended durations

100ms

150ms

200ms

250ms

Maximum

300ms

---

Loading Experience

Skeletons preferred over spinners.

Avoid blocking entire pages.

Support progressive loading.

---

Empty States

Every empty state must contain

Illustration

Title

Description

Primary Action

Optional Documentation Link

---

Error States

Explain what happened.

Explain what users can do next.

Provide Retry where possible.

Avoid technical jargon.

---

Notifications

Toast

Temporary

Banner

Persistent

Modal

Critical

Notifications should never interrupt workflows unnecessarily.

---

Responsive Design

Desktop

1280+

Laptop

1024–1279

Tablet

768–1023

Mobile

Below 768

Every component must define behavior across all breakpoints.

---

Dark Mode

Not included in Version 1.

All design tokens should be compatible with future dark mode implementation.

---

Accessibility Standards

WCAG AA minimum.

Keyboard accessible.

Visible focus states.

Touch targets ≥44px.

ARIA labels where required.

Semantic HTML.

---

Performance Guidelines

Lazy loading.

Virtual scrolling.

Optimized images.

Code splitting.

Skeleton loading.

Optimistic UI where appropriate.

---

Design Tokens

The frontend should expose tokens for:

Colors

Typography

Spacing

Radius

Elevation

Motion

Opacity

Breakpoints

Z-index

These tokens become the single source of truth for styling.

---

Figma Organization

Pages

Foundations

Components

Patterns

Public Website

Owner Dashboard

Tenant Dashboard

Future

Every component should exist once and be reused.

---

Design Review Checklist

Before implementation verify:

✓ Uses approved components

✓ Uses design tokens

✓ Responsive

✓ Accessible

✓ Mobile-first

✓ Consistent spacing

✓ Correct typography

✓ Proper hierarchy

✓ Uses reusable layouts

✓ Meets performance expectations

---

Future Considerations

Dark Mode

Theme Customization

RTL Support

Localization

Accessibility Enhancements

Advanced Motion

Multi-brand Support

---

Conclusion

The StayO Design System is the foundation of every user interface in the product.

All future designs, prototypes, and implementations must follow this document to ensure a consistent, scalable, and maintainable user experience.

No component or screen should intentionally diverge from these guidelines without a documented design decision.