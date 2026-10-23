import type { Metadata } from 'next'

// The live apex redirects to www. Deployment overrides must use the same
// preferred origin so canonical URLs, the sitemap, and brand identity agree.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://www.mycloove.com'
).replace(/\/+$/, '')

export function pageMetadata(
  path: `/${string}`,
  title: string,
  description: string,
): Metadata {
  const brandedTitle = `${title} | mycloove`
  return {
    // The root title template supplies the brand once for the document title.
    title,
    description,
    alternates: { canonical: path },
    // Next shallow-merges nested metadata. Leaf overrides must explicitly
    // retain the existing root image; file metadata is not a deep fallback.
    openGraph: {
      type: 'website',
      siteName: 'mycloove',
      title: brandedTitle,
      description,
      url: path,
      locale: 'en_US',
      images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'mycloove document tools' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: brandedTitle,
      description,
      images: [{ url: '/opengraph-image', alt: 'mycloove document tools' }],
    },
  }
}
