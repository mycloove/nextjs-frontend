import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/.prisma/client/**/*"],
  },
  // Next 16 blocks dev resources (the HMR socket included) for hosts it
  // considers cross-origin. `npm run dev` binds 0.0.0.0 while browsers and e2e
  // tests open the app through 127.0.0.1 — without this allowlist the page
  // paints its SSR HTML but never hydrates, so no click handler attaches.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  output: "standalone",
  // Never advertise the framework version.
  poweredByHeader: false,
  // Response security headers applied to every route. Kept deliberately minimal
  // and non-breaking: no default-src, so inline styles (PDF editor inline <style>
  // blocks, Mr. Markdown) and blob workers (pdf.js) keep working. `object-src
  // 'none'` disables plugin/<object> embedding (nothing in the app uses it), and
  // `frame-ancestors 'none'` blocks clickjacking in modern browsers while
  // X-Frame-Options covers the rest. HSTS is ignored over plain HTTP and takes
  // effect once the edge terminates TLS; `preload` stays off until the domain set
  // is final.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'" },
        ],
      },
    ]
  },
  // Playwright can start a second dev server while a local instance is already
  // running. Keep its Next 16 dev lock separate without changing the normal
  // build directory used by development, production, or other commands.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Mr. Markdown's public URL is /mr-markdown; the internal tool id, the
  // features/pdf-to-markdown shim and the /api/pdf-to-markdown route all keep
  // the old name. The route folder was renamed in place, so this redirect is
  // the only thing standing between a bookmarked /pdf-to-markdown link and a
  // 404. Source patterns are anchored, so /api/pdf-to-markdown never matches.
  async redirects() {
    return [
      { source: "/pdf-to-markdown", destination: "/mr-markdown", permanent: true },
      // The 4-in-1 PDF Tools workbench was split into four focused tools
      // (merge/split/rotate/compress), each with its own URL. This keeps old
      // /pdf-tools bookmarks alive without resurrecting the combined page.
      { source: "/pdf-tools", destination: "/merge-pdf", permanent: false },
    ];
  },
  // proxy.ts runs on every non-static request, so Next buffers each request
  // body in memory to let the proxy and the route handler both read it.
  // The default cap is 10mb, and Next SILENTLY TRUNCATES bodies past the cap
  // (documented in node_modules/next/dist/docs/.../proxyClientMaxBodySize.md),
  // which turns any multipart upload >10mb into a truncated stream and kills
  // request.formData() with "Failed to parse body as FormData" (a 500 on every
  // tool route, seen first on /api/seq-tools). Keep this above the backend's
  // MAX_CONTENT_LENGTH (100 MiB, pdf-microservice/app.py) so Flask remains the
  // single size authority and returns its designed 413 file_too_large.
  experimental: {
    proxyClientMaxBodySize: "110mb",
  },
  webpack: (config) => {
    // Required for pdfjs-dist
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    return config;
  },
  turbopack: {
    // Playwright starts Next through npm from the repository root. Resolve the
    // Turbopack workspace from this config file so PostCSS plugins and local
    // dependencies are loaded from nextjs-frontend regardless of the caller's
    // working directory.
    root: __dirname,
  },
};

export default nextConfig;
