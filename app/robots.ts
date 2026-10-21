import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mycloove.com'

/**
 * Crawler directives. The conversion routes stay crawlable, but the private
 * surfaces (admin, auth, API) are disallowed — they would only waste crawl
 * budget and some require a session.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/login', '/register', '/reset-password', '/api/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
