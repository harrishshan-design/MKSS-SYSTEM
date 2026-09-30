# MKSS SYSTEM

Lorry movement and security attendance PWA for a single warehouse or factory site. The app has **admin**, **security guard**, and **driver** roles. There is no warehouse staff account or workflow.

## What is included

- Admin dashboard, live vehicle board, master data, visit history, attendance, reports and site settings
- Permanent random driver QR, camera scanner, duplicate active visit protection and visit registration
- Company and optional loading geofences, GPS accuracy checks, 120-second exit confirmation, automatic checkout and delay alerts
- Admin-only corrections with required reasons and audit logs
- PostgreSQL as the source of truth, with queued Microsoft Graph Excel Online synchronization
- Installable PWA shell and responsive guard/driver screens
- Driver sign-up with email confirmation (when enabled in Supabase), pending status and admin approval

## Important location limitation

The driver page uses the browser Geolocation API while open and location sharing is enabled. **A PWA cannot guarantee background GPS delivery on Android or iOS after the browser is suspended or closed.** If updates stop during departure, automatic checkout waits for another valid outside reading. For unattended production tracking, connect the separated location/geofence API to a native Android/iOS background location service or a managed vehicle telematics device. The API and geofence logic are independent of the UI. The admin correction flow is available for exceptional missed exits.

## Local setup

1. Install Node.js 22 or newer, then run `npm ci`.
2. Copy `.env.example` to `.env.local` and fill in the values below. Never commit `.env.local`.
3. Create a Supabase project. Apply **both** SQL files in `supabase/migrations` in filename order in the Supabase SQL editor, or use the Supabase CLI migration workflow. This project uses server routes with a service role key; exposed public tables have RLS enabled with no direct browser policies. Ensure the `public` schema is enabled in Supabase Data API settings for server routes.
4. In Supabase Authentication, configure your site URL and SMTP service for user invitations and driver sign-up confirmation. Add your deployed app URL to the allowed redirect URLs. Create your first admin account in Authentication → Users with an email and password you choose. Copy its UUID, then run:

   ```sql
   insert into public.users (id, name, role)
   values ('YOUR_AUTH_USER_UUID', 'Site Administrator', 'admin');
   ```

5. Run `npm run dev` and open `http://localhost:3000`. Sign in as the admin. **There is no default email or password.**
6. Create companies, lorries and security guards. Drivers can choose **Create an account** on the sign-in screen. Their request appears under **Driver registrations** after they sign up. Select the matching registered company and an unassigned lorry, then approve. Approval creates the driver record, links the lorry and grants driver access. You can also create driver records yourself and invite drivers or guards through **User accounts**. Configure the company geofence in **Site settings** before tracking visits.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key |
| `APP_URL` | Public application origin, such as `https://example.com` |
| `CRON_SECRET` | Secret bearer token for `/api/cron` |
| `MICROSOFT_CLIENT_ID` | Microsoft Entra application ID |
| `MICROSOFT_CLIENT_SECRET` | Entra client secret; server only |
| `MICROSOFT_TENANT_ID` | Entra tenant ID |
| `MICROSOFT_DRIVE_ID` | OneDrive or SharePoint drive ID |
| `MICROSOFT_WORKBOOK_ID` | Drive item ID of an existing `.xlsx` workbook |
| `MICROSOFT_TOKEN_ENCRYPTION_KEY` | Base64-encoded random 32-byte key for AES-256-GCM token encryption |

Generate the encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep it stable and secret; rotating it requires reconnecting Microsoft.

## Microsoft Entra and Excel setup

1. Create an Entra app registration for your organization and add a **Web** redirect URI: `APP_URL/api/microsoft/callback`.
2. Create a client secret. Add Microsoft Graph **delegated** `Files.ReadWrite` and `User.Read` permissions. Grant consent as required by your tenant. The app also requests `offline_access` for a refresh token. Microsoft Graph Excel workbook APIs do **not** support application permissions for these operations.
3. Create an empty `.xlsx` workbook in OneDrive for Business or SharePoint. Set the drive and workbook item IDs in the environment. The app creates/uses these worksheets on first sync: `DAILY_LORRY_MOVEMENT`, `DRIVERS`, `COMPANIES`, `LORRIES`, `SECURITY_ATTENDANCE`, `GEOFENCE_EVENTS`.
4. In MKSS SYSTEM, open **Excel sync** and select **Connect Microsoft**. Sign in as an account with edit access to the workbook. The refresh token is encrypted before storage in `microsoft_connections`; it is never sent to the browser.
5. Set up `/api/cron` to run every five minutes with `Authorization: Bearer CRON_SECRET`. The supplied `vercel.json` defines this schedule for Vercel. The worker processes queued changes, retries with backoff and leaves the database intact if Graph is unavailable.

The workbook is an output mirror. Administrators should avoid rearranging headers or manually moving rows because the sync worker matches records by the first column. Excel string values beginning with formula operators are escaped.

## Visit flow

1. Guard scans the driver's permanent QR and confirms entry. The server creates one active visit per lorry, records the guard and registration time, and blocks duplicates.
2. While the driver's PWA is open, an active visit starts location monitoring and may prompt for location permission. A valid GPS fix inside the company radius records `company_time_in`.
3. If configured, loading-zone entry and exit record their timestamps and duration.
4. The first valid outside fix marks an exit pending. Another outside fix after the configured confirmation period completes the visit. A return inside cancels the pending exit.
5. The dashboard polls automatically every 10 seconds and timers update every second. The cron worker flags visits exceeding the configured threshold as delayed.
6. Significant changes enqueue Excel sync jobs. The admin can review status and retry failed jobs.

## Deployment

Deploy to a secure HTTPS origin (for camera and geolocation permissions). Vercel is supported. Configure all environment variables in the deployment platform, set `APP_URL` to the deployed origin, add that origin to Supabase Auth settings, and update the Entra redirect URI. Protect the Supabase service key, Entra secret, token encryption key and cron secret. Keep the app and database in a suitable data residency region for your organization.

Before live use, test real Android and iOS devices at the site, verify GPS accuracy and exit timing, validate invited accounts and roles, and run an end-to-end Excel sync against the actual tenant workbook. This repository has no tenant credentials, so live Supabase/Graph behavior cannot be verified locally without configuration.

## Checks

Run `npm test`, `npx tsc --noEmit`, `npm run build`, and `npm audit`.
