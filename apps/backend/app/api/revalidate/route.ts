import { revalidateTag } from 'next/cache'
import { type NextRequest, NextResponse } from 'next/server'

const REVALIDATION_SECRET = process.env.SANITY_REVALIDATE_SECRET

const DOCUMENT_TYPE_TO_TAG: Record<string, string> = {
  siteSettings: 'siteSettings',
  landingHostel: 'landingHostel',
  testimonial: 'testimonial',
  faq: 'faq',
  categoryRating: 'categoryRating',
}

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')

  if (secret !== REVALIDATION_SECRET) {
    return NextResponse.json({ message: 'Invalid secret' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const documentType = body?._type

    const tag = DOCUMENT_TYPE_TO_TAG[documentType]

    if (tag) {
      revalidateTag(tag)
      return NextResponse.json({
        revalidated: true,
        tag,
        now: Date.now(),
      })
    }

    return NextResponse.json({ message: 'Unknown document type' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ message: 'Error revalidating' }, { status: 500 })
  }
}
