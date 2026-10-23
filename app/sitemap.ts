import type { MetadataRoute } from 'next'

import { tools } from '../lib/tools/registry.ts'
import { SITE_URL } from '../lib/metadata.ts'

/**
 * Sitemap for the global launch. Built from the tool registry so a new tool
 * appears here automatically once it is registered (lib/tools/registry.ts).
 * Admin, auth, and API routes are intentionally excluded.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // No reliable significant-content dates are tracked yet. A build/request
  // timestamp would falsely report every URL as updated, so lastModified is omitted.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/about-us`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/contact-us`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/pricing`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/faq`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    // Standalone apps (not in the registry).
    { url: `${SITE_URL}/pdf-editor`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/document-ai`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/image-editor`, changeFrequency: 'weekly', priority: 0.7 },
  ]

  const toolRoutes: MetadataRoute.Sitemap = tools.map((tool) => ({
    url: `${SITE_URL}${tool.href}`,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  return [...staticRoutes, ...toolRoutes]
}
