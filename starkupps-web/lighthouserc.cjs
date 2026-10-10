/**
 * Lighthouse CI — performance budgets as a merge gate.
 *
 * Run locally:  npx @lhci/cli autorun
 * In CI:        .github/workflows/seo.yml (same command).
 *
 * Thresholds are set BELOW today's lab numbers (mobile, emulated Moto G4)
 * so normal variance stays green and only real regressions fail:
 *   today: perf 82–86, SEO/a11y 100, LCP 3.8–4.3s, TBT ≤100ms, CLS ~0.
 * Tighten LCP only after field data (CrUX) exists — the emulated number is
 * dominated by headless software rasterization (see docs/seo log).
 */
module.exports = {
  ci: {
    collect: {
      // Serves the PRERENDERED dist/ (cleanUrls work: /menu/pizza included).
      startServerCommand: "npx vite preview --port 4173 --strictPort",
      url: [
        "http://localhost:4173/",
        "http://localhost:4173/menu",
        "http://localhost:4173/menu/pizza",
        "http://localhost:4173/contact",
        "http://localhost:4173/faq",
      ],
      numberOfRuns: 1,
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.75 }],
        "categories:seo": ["error", { minScore: 0.95 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 5000 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        "total-blocking-time": ["warn", { maxNumericValue: 300 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "./.lighthouseci",
    },
  },
};
