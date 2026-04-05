# Cubitopia Deployment Guide

## Overview

Cubitopia deploys as a static site via GitHub Pages. The build system uses Vite with TypeScript.

## Architecture

- **Build tool:** Vite 5.x
- **Language:** TypeScript 5.x
- **Output:** Static files in `dist/`
- **Hosting:** GitHub Pages (free, auto-deployed on push to main)
- **Base path:** `/cubitopia/` in production, `/` in dev

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start local dev server with HMR |
| `npm run build` | Build for local testing (base `/`) |
| `npm run build:prod` | Build for production (base `/cubitopia/`) |
| `npm run preview` | Preview production build locally |
| `npm run deploy` | Build for prod and remind to push |

## How Deployment Works

1. Push commits to `main` branch
2. GitHub Actions workflow (`.github/workflows/deploy.yml`) triggers automatically
3. Workflow installs deps, runs `npm run build`, uploads `dist/` to GitHub Pages
4. Site is live at `https://<username>.github.io/cubitopia/`

You can also trigger a manual deploy from the GitHub Actions tab using "workflow_dispatch".

## First-Time Setup

1. Go to your GitHub repo Settings > Pages
2. Under "Build and deployment", select **GitHub Actions** as the source
3. Push to `main` — the workflow will run automatically
4. Your site will be live at `https://<username>.github.io/cubitopia/`

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `GITHUB_ACTIONS` | CI workflow | Sets Vite base to `/cubitopia/` for GitHub Pages |

## Local Testing of Production Build

```bash
npm run build:prod
npm run preview
# Opens at http://localhost:4173/cubitopia/
```

## Troubleshooting

**404 on page load:** Ensure GitHub Pages source is set to "GitHub Actions" (not "Deploy from branch").

**Assets not loading:** Check that `vite.config.ts` base is set correctly. The config automatically uses `/cubitopia/` when `GITHUB_ACTIONS` env var is set.

**Build fails on CI:** Run `npm run build` locally first to catch TypeScript errors. Note: there are some pre-existing TS errors from in-progress streams (startingGold, VOLCANIC) that the CI build may flag — these will be resolved when those streams complete.
