# Employee Certificate System — Serverless (Vercel + Turso)

This is the serverless version of the Stage 1 system: no server process to
keep running yourself. Code lives on GitHub, Vercel deploys it automatically
on every push, and the database is hosted on Turso (cloud SQLite).

## Architecture
- **Hosting/compute:** Vercel serverless functions (each file in `/api` is one endpoint)
- **Database:** Turso (hosted SQLite), accessed over the network via `@libsql/client`
- **Auth:** stateless — a signed JWT stored in an `httpOnly` cookie (no server-side session storage needed)
- **PDF generation:** PDFKit, generated in memory at download time (no persistent disk in serverless, so nothing is saved as a file — it's regenerated fresh from the stored data each time you click Download)
- **Frontend:** same plain HTML/CSS/JS as before, served as static files by Vercel

## One-time setup

### 1. Create the Turso database
Install the Turso CLI and create a database (run this on your own machine, once):
```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
turso db create empcerts
turso db show empcerts --url        # copy this — it's TURSO_DATABASE_URL
turso db tokens create empcerts     # copy this — it's TURSO_AUTH_TOKEN
```

### 2. Seed the database with demo users
```bash
npm install
cp .env.example .env
# paste your TURSO_DATABASE_URL and TURSO_AUTH_TOKEN into .env
npm run seed
```
This creates 4 demo accounts (see table below).

### 3. Push this code to your GitHub repo
```bash
git init
git add .
git commit -m "Serverless employee certificate system"
git branch -M main
git remote add origin https://github.com/pbfluffy/EmpCerts.git
git push -u origin main
```
(If the repo already has commits, use `git pull --rebase origin main` first, or push to a new branch and open a PR — let me know which you'd prefer.)

### 4. Connect the repo to Vercel
1. Go to vercel.com → "Add New" → "Project"
2. Choose "Import Git Repository" and select `EmpCerts`
3. Before deploying, open "Environment Variables" and add:
   - `TURSO_DATABASE_URL` — same value as in your `.env`
   - `TURSO_AUTH_TOKEN` — same value as in your `.env`
   - `SESSION_SECRET` — any long random string (used to sign login cookies)
4. Click Deploy

Vercel gives you a live URL (like `empcerts.vercel.app`) immediately, and
will redeploy automatically every time you push to GitHub.

## Demo accounts (created by `npm run seed`)
| Username | Password | Role |
|---|---|---|
| admin | Admin@123 | System Administrator |
| hrdirector | HrDir@123 | HR Director |
| hrstaff | HrStaff@123 | HR Staff |
| employee1 | Employee@123 | Employee |

Change or remove these before real use.

## What's implemented
Same feature set as the Stage 1 spec:
- Local login (hashed passwords, JWT session cookie)
- Certificate request form (Reason, Other Reason, Include Salary, Salary
  Amount, Language, Delivery Method, Remarks)
- No-salary requests auto-complete immediately
- Salary requests go to Pending Approval → HR Director/Admin approve or
  reject → on approval, status becomes Completed
- Role-based access control (employees see only their own requests; HR
  Staff/Director/Admin see all; only HR Director/Admin can approve; only
  Admin manages users)
- PDF certificate generation and download
- Admin panel (create users, assign roles, enable/disable accounts)
- Audit log of logins, submissions, approvals/rejections, generation, and downloads

## Still not implemented (same as before)
- **Actual email sending** — Delivery Method "Email" is stored but no email
  is sent (no SMTP/notification service wired up yet)
- **Multi-language certificate templates** — schema exists, single English
  layout is hardcoded
- **Microsoft 365 SSO** — Stage 2+ per the original spec

## Local development
You can run the API functions locally with the Vercel CLI:
```bash
npm install -g vercel
vercel dev
```
This reads your `.env` file and serves both the static frontend and the
`/api` functions on `http://localhost:3000`, behaving the same as production.

## Project structure
```
api/
  auth/login.js, logout.js, me.js
  requests/index.js              # GET list / POST create
  requests/[id]/index.js          # GET single
  requests/[id]/download.js        # GET PDF (generated on demand)
  approvals/pending.js
  approvals/[id]/decision.js
  admin/users/index.js              # GET list / POST create
  admin/users/[id].js                 # PUT update
  admin/audit-log.js
lib/
  db.js      # Turso client, schema, query helpers
  auth.js     # JWT cookie helpers, requireAuth/requireRole wrappers
  pdf.js       # in-memory PDF generation
scripts/seed.js   # run locally to create demo users
index.html, dashboard.html, new-request.html, approvals.html, admin.html
css/, js/common.js
```
