import { defineType, defineField } from 'sanity'

export const categoryRating = defineType({
  name: 'categoryRating',
  title: 'Category Ratings',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    defineField({
      name: 'overallRating',
      title: 'Overall Rating',
      type: 'number',
      validation: Rule => Rule.required().min(1).max(5).precision(1),
    }),
    defineField({
      name: 'totalReviews',
      title: 'Total Reviews',
      type: 'number',
      validation: Rule => Rule.required().min(0).integer(),
    }),
    defineField({
      name: 'foodQuality',
      title: 'Food Quality',
      type: 'number',
      validation: Rule => Rule.required().min(1).max(5).precision(1),
    }),
    defineField({
      name: 'cleanliness',
      title: 'Cleanliness',
      type: 'number',
      validation: Rule => Rule.required().min(1).max(5).precision(1),
    }),
    defineField({
      name: 'safety',
      title: 'Safety',
      type: 'number',
      validation: Rule => Rule.required().min(1).max(5).precision(1),
    }),
    defineField({
      name: 'valueForMoney',
      title: 'Value for Money',
      type: 'number',
      validation: Rule => Rule.required().min(1).max(5).precision(1),
    }),
  ],
  preview: {
    prepare() {
      return { title: 'Category Ratings' }
    },
  },
})
