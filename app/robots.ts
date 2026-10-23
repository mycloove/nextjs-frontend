import type { MetadataRoute } from 'next'

import { SITE_URL } from '../lib/metadata'

/**
 * Crawler directives. The conversion routes stay crawlable, but the private
 * surfaces (admin, auth, API) are disallowed — they would only waste crawl
 * budget and some require a session. These directives are not access control;
 * the profile remains crawlable so its explicit noindex can be read.
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
