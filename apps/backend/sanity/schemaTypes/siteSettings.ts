import { defineType, defineField } from 'sanity'

export const siteSettings = defineType({
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    defineField({
      name: 'phoneNumber',
      title: 'Phone Number',
      type: 'string',
      description: 'Main contact number shown in top bar and contact section',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'whatsappNumber',
      title: 'WhatsApp Number',
      type: 'string',
      description: 'WhatsApp number with country code, no + or spaces. Example: 919392433422',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'email',
      title: 'Email Address',
      type: 'string',
    }),
    defineField({
      name: 'address',
      title: 'Address',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'googleRating',
      title: 'Google Rating',
      type: 'number',
      description: 'Current Google star rating. Example: 4.2',
      validation: Rule => Rule.min(1).max(5).precision(1),
    }),
    defineField({
      name: 'googleReviewCount',
      title: 'Google Review Count',
      type: 'number',
      description: 'Total number of Google reviews',
      validation: Rule => Rule.min(0).integer(),
    }),
    defineField({
      name: 'totalStudents',
      title: 'Total Students Currently',
      type: 'number',
      description: 'Shown as "Join 78+ SNIST students" in hero. Update when tenant count changes.',
      validation: Rule => Rule.min(0).integer(),
    }),
    defineField({
      name: 'ownerName',
      title: 'Owner Name',
      type: 'string',
    }),
    defineField({
      name: 'ownerTitle',
      title: 'Owner Title',
      type: 'string',
      description: 'Example: Owner, Sri Adithya Boys Hostel',
    }),
    defineField({
      name: 'ownerQuote',
      title: 'Owner Quote',
      type: 'string',
      description: 'Shown in contact section. Keep it short and personal.',
      validation: Rule => Rule.max(120),
    }),
    defineField({
      name: 'ownerPhoto',
      title: 'Owner Photo',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'establishmentYear',
      title: 'Establishment Year',
      type: 'number',
      description: 'The year the hostel was established (e.g. 2019)',
      validation: Rule => Rule.min(1900).integer(),
    }),
    defineField({
      name: 'googleMapsUrl',
      title: 'Google Maps Directions URL',
      type: 'url',
      description: 'The directions link for the hostel on Google Maps',
    }),
    defineField({
      name: 'googleReadReviewsUrl',
      title: 'Google Maps Read Reviews URL',
      type: 'url',
      description: 'The link to read Google reviews for the hostel',
    }),
    defineField({
      name: 'googleWriteReviewUrl',
      title: 'Google Maps Write Review URL',
      type: 'url',
      description: 'The link to write a Google review for the hostel',
    }),
    defineField({
      name: 'seoTitle',
      title: 'SEO Page Title',
      type: 'string',
      description: 'Title tag for the homepage',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'seoDescription',
      title: 'SEO Meta Description',
      type: 'text',
      description: 'Meta description for search engine listings',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'ogTitle',
      title: 'OpenGraph Title',
      type: 'string',
      description: 'Title for social media shares',
    }),
    defineField({
      name: 'ogDescription',
      title: 'OpenGraph Description',
      type: 'text',
      description: 'Description for social media shares',
    }),
    defineField({
      name: 'seoSiteName',
      title: 'SEO Site Name',
      type: 'string',
      description: 'Name of the website/brand for search engines',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'canonicalUrl',
      title: 'Canonical URL',
      type: 'url',
      description: 'The primary canonical URL of the website',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'whatsappFABTemplate',
      title: 'WhatsApp FAB Template',
      type: 'string',
      description: 'WhatsApp template for Floating Action Button. Supports {hostelName}',
    }),
    defineField({
      name: 'whatsappHeroTemplate',
      title: 'WhatsApp Hero Template',
      type: 'string',
      description: 'WhatsApp template for Hero section CTA. Supports {hostelName}',
    }),
    defineField({
      name: 'whatsappRoomBookingTemplate',
      title: 'WhatsApp Room Booking Template',
      type: 'string',
      description: 'WhatsApp template for Room Pricing section cards. Supports {hostelName} and {sharingType}',
    }),
    defineField({
      name: 'whatsappAdmissionTemplate',
      title: 'WhatsApp Admission Template',
      type: 'string',
      description: 'WhatsApp template for Admission Process section. Supports {hostelName}',
    }),
    defineField({
      name: 'whatsappEnquiryTemplate',
      title: 'WhatsApp Enquiry Template',
      type: 'text',
      description: 'WhatsApp message format for the Enquiry Form. Supports {hostelName}, {name}, {phone}, {moveInMonth}, and {message}',
    }),
    defineField({
      name: 'announcements',
      title: 'Announcements',
      type: 'array',
      description: 'Active announcement banners shown at the top of the page',
      of: [
        {
          type: 'object',
          name: 'announcement',
          fields: [
            { name: 'title', type: 'string', title: 'Title', validation: Rule => Rule.required() },
            { name: 'description', type: 'string', title: 'Description' },
            {
              name: 'cta',
              type: 'object',
              title: 'Call to Action (CTA)',
              fields: [
                { name: 'label', type: 'string', title: 'Label', validation: Rule => Rule.required() },
                { name: 'href', type: 'string', title: 'Link / Anchor Href', validation: Rule => Rule.required() },
              ]
            },
            { name: 'isActive', type: 'boolean', title: 'Is Active', initialValue: true }
          ]
        }
      ]
    }),
  ],
  preview: {
    prepare() {
      return { title: 'Site Settings' }
    },
  },
})
