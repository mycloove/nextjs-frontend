This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Prisma, Node, and `scripts/prisma.mjs`

`npm run dev`, `npm run build` and `npm run typecheck` run `prisma generate`
through `scripts/prisma.mjs` instead of calling the Prisma CLI directly. The
launcher is required because Prisma 7's CLI eagerly loads `@prisma/dev`, whose
CommonJS bundle (`dist/state.cjs`) does `require("zeptomatch")`, and `zeptomatch`
only publishes an ESM build. Loading ESM from `require()` is enabled by default
on Node >= 20.19 and >= 22.12 (this is why `prisma/package.json` declares
`engines.node: "^20.19 || ^22.12 || >=24"`); on Node 20.17-20.18 and 22.0-22.11
the same loader sits behind `--experimental-require-module`, which is exactly
what the launcher adds when the running Node needs it. Without it, every Prisma
command fails with:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../zeptomatch/dist/index.js ... not supported.
```

Upgrading to Node 22.12+ (or 24) is the long-term fix and turns the launcher into
a no-op; until then it keeps the scripts working on every Node version Prisma
supports.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
