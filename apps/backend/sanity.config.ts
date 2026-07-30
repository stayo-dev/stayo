import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { visionTool } from '@sanity/vision'
import { structure } from './sanity/structure'
import {
  siteSettings,
  testimonial,
  faq,
  categoryRating,
  landingHostel,
} from './sanity/schemaTypes'

export default defineConfig({
  name: 'sri-adithya-hostels',
  title: 'Sri Adithya Boys Hostel',
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  basePath: '/studio',
  plugins: [
    structureTool({ structure }),
    visionTool(),
  ],
  schema: {
    types: [siteSettings, testimonial, faq, categoryRating, landingHostel],
  },
})
