import { defineType, defineField } from 'sanity'

export const testimonial = defineType({
  name: 'testimonial',
  title: 'Testimonial',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      description: 'Example: Ravi K. or Father of Karthik R.',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'image',
      title: 'Profile Picture / Photo',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'type',
      title: 'Type',
      type: 'string',
      options: {
        list: [
          { title: 'Student', value: 'student' },
          { title: 'Parent', value: 'parent' },
        ],
        layout: 'radio',
      },
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'year',
      title: 'Year',
      type: 'string',
      description: 'Only for students. Example: 3rd Year',
      hidden: ({ document }) => document?.type !== 'student',
    }),
    defineField({
      name: 'branch',
      title: 'Branch',
      type: 'string',
      description: 'Only for students. Example: B.Tech CSE',
      hidden: ({ document }) => document?.type !== 'student',
    }),
    defineField({
      name: 'college',
      title: 'College',
      type: 'string',
      description: 'Only for students. Example: SNIST',
      hidden: ({ document }) => document?.type !== 'student',
    }),
    defineField({
      name: 'location',
      title: 'Location / City',
      type: 'string',
      description: 'Only for parents. Example: Vizag',
      hidden: ({ document }) => document?.type !== 'parent',
    }),
    defineField({
      name: 'rating',
      title: 'Star Rating',
      type: 'number',
      validation: Rule => Rule.required().min(1).max(5).integer(),
    }),
    defineField({
      name: 'quote',
      title: 'Review Quote',
      type: 'text',
      rows: 4,
      description: 'Keep under 200 characters for consistent card height.',
      validation: Rule => Rule.required().max(250),
    }),
    defineField({
      name: 'tag',
      title: 'Tag',
      type: 'string',
      description: 'Example: Stayed 18 months / Current Resident / Parent · Verified Stay',
    }),
    defineField({
      name: 'isActive',
      title: 'Show on Website',
      type: 'boolean',
      description: 'Toggle off to hide without deleting.',
      initialValue: true,
    }),
    defineField({
      name: 'order',
      title: 'Display Order',
      type: 'number',
      description: 'Lower number = shown first. Students: 1,2,3. Parent: 4.',
    }),
  ],
  orderings: [
    {
      title: 'Display Order',
      name: 'orderAsc',
      by: [{ field: 'order', direction: 'asc' }],
    },
  ],
  preview: {
    select: { title: 'name', subtitle: 'type', media: 'image' },
    prepare({ title, subtitle, media }) {
      return {
        title,
        subtitle: subtitle === 'parent' ? '👨👩👦 Parent Review' : '🎓 Student Review',
        media,
      }
    },
  },
})
