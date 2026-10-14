# MKSS SYSTEM

Lorry movement and security attendance PWA for a single warehouse or factory site. The app has **admin**, **security guard**, and **driver** roles. There is no warehouse staff account or workflow.

## What is included

- Admin dashboard, live vehicle board, master data, visit history, attendance, reports and site settings
- Permanent random driver QR, camera scanner, duplicate active visit protection and visit registration
- Separate site-entry and checkout geofences, GPS accuracy checks, 120-second exit confirmation, automatic checkout and delay alerts
- Admin-only corrections with required reasons and audit logs
- PostgreSQL as the source of truth, with queued Microsoft Graph Excel Online synchronization
- Installable PWA shell and responsive guard/driver screens
- Driver sign-up without an email confirmation link, followed by admin approval and lorry assignment
- One-tap driver camera scan of the daily site QR, saving attendance and opening the assigned lorry visit in one database transaction

## Important location limitation

The driver page uses the browser Geolocation API while open and location sharing is enabled. **A PWA cannot guarantee background GPS delivery on Android or iOS after the browser is suspended or closed.** If updates stop during departure, automatic checkout waits for another valid outside reading. For unattended production tracking, connect the separated location/geofence API to a native Android/iOS background location service or a managed vehicle telematics device. The API and geofence logic are independent of the UI. The admin correction flow is available for exceptional missed exits.

## Local setup

1. Install Node.js 22 or newer, then run `npm ci`.
2. Copy `.env.example` to `.env.local` and fill in the values below. Never commit `.env.local`.
3. Create a Supabase project. Apply **all** SQL files in `supabase/migrations` in filename order in the Supabase SQL editor, or use the Supabase CLI migration workflow. This project uses server routes with a service role key; exposed public tables have RLS enabled with no direct browser policies. Ensure the `public` schema is enabled in Supabase Data API settings for server routes.
4. In Supabase Authentication, configure your site URL and SMTP service if you use account invitations or password recovery. Driver sign-up itself does not send an email confirmation link. Add your deployed app URL to the allowed redirect URLs. Create your first admin account in Authentication → Users with an email and password you choose. Copy its UUID, then run:

   ```sql
   insert into public.users (id, name, role)
   values ('YOUR_AUTH_USER_UUID', 'Site Administrator', 'admin');
   ```

5. Run `npm run dev` and open `http://localhost:3000`. Sign in as the admin. **There is no default email or password.**
6. Drivers can choose **Create an account** on the sign-in screen. Their request appears under **Driver registrations**; review or correct the submitted details, then approve. Admins see a pending approval count in the sidebar and header bell, with a brief in-app alert when a new request arrives while MKSS is open. The count refreshes about every five seconds and updates after approval. Admins can also enable phone push alerts in the bell menu for requests arriving while MKSS is closed. Approval creates the driver, company, and lorry records as needed. Guards are optional for the driver daily QR flow; create and invite guards if gate scans are used. Configure the company geofence in **Site settings** before tracking visits.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key |
| `APP_URL` | Public application origin, such as `https://example.com` |
| `CRON_SECRET` | Secret bearer token for `/api/cron` |
| `WEB_PUSH_PUBLIC_KEY` | VAPID public key for admin phone notifications |
| `WEB_PUSH_PRIVATE_KEY` | VAPID private key; server only |
| `MICROSOFT_CLIENT_ID` | Microsoft Entra application ID |
| `MICROSOFT_CLIENT_SECRET` | Entra client secret; server only |
| `MICROSOFT_TOKEN_ENCRYPTION_KEY` | Base64-encoded random 32-byte key for AES-256-GCM token encryption |

Generate the encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep it stable and secret; rotating it requires reconnecting Microsoft.

### Admin phone notifications

Generate one VAPID key pair with `node -e "console.log(require('web-push').generateVAPIDKeys())"` and set the public and private keys in the deployment environment. Keep the private key secret and stable; changing either key requires admins to enable alerts again on each device. Sign in as an admin on the phone, open the header bell, tap **Enable phone alerts**, and allow notifications. Use **Send test** to confirm delivery. On iPhone, first open MKSS in Safari, use **Share → Add to Home Screen**, then open the installed MKSS icon and enable alerts there. Each admin phone must opt in separately. These are PWA push notifications, not WhatsApp messages; phone settings, Focus modes, connectivity, and push provider delivery can affect arrival. New signups remain in Supabase and the admin approval queue even if a push fails. Failed push sends are queued for retry by `/api/cron`.

## CSV exports and backup site QR

Supabase is the live source of truth. Microsoft Excel synchronization is paused; it is not needed for driver registration, daily attendance, trips, or exports. Existing Microsoft connection details and queued sync records are retained for a possible later restart, but new transactions do not create Excel jobs and the cron does not send records to Excel.

Administrators can export complete CSV files for drivers, lorries, companies, visit history, today's reports, and driver daily check-ins. Visit and master-data exports read all matching database pages, including ranges above 350 records. The history screen may show only the latest 1,000 visits, but its CSV includes every visit in the selected date range. CSV files use UTF-8 and escape spreadsheet formulas.

**Daily site QR & attendance** also shows a printable backup site QR. Print it once and keep it at the gate. Signed-in drivers and guards can scan it if the daily QR is unavailable. MKSS checks the code on the server, uses the current Malaysia date, and saves the actual scan timestamp in Supabase. The backup QR is permanent, so store and display it only at the gate; the daily QR remains the preferred code.
## Visit flow

1. MKSS generates one daily site QR at midnight Malaysia time, or when an admin first opens **Daily site QR & attendance** that day. After signing up and being approved once, a driver signs in and scans this QR each day. In one database transaction, MKSS saves attendance and opens a visit for the assigned lorry (unless an active visit already exists). The same day's repeat scan displays the existing check-in. The admin can review and export check-ins as CSV. Guards use the site QR separately for their shift attendance.
2. A guard can also scan the driver's permanent QR to register the lorry. Duplicate active visits are blocked.
3. While the driver's PWA is open, an active visit starts location monitoring and may prompt for location permission. A valid GPS fix inside the company radius records `company_time_in`.
4. If configured, loading-zone entry and exit record their timestamps and duration.
5. The first valid fix outside the site-entry radius marks the visit as leaving. A valid fix beyond the configured checkout distance after the confirmation period completes it. A return inside the site-entry radius cancels the pending exit. The MKSS production site uses a 300 m entry radius and a 5 km checkout distance.
6. The live movement board polls every 3 seconds while open, shows every open driver and lorry visit plus GPS freshness, and lists completed exits. Other dashboard sections poll every 10 seconds; timers update every second. The cron worker flags visits exceeding the configured threshold as delayed.
7. Visit history and today's reports can be exported as CSV. Microsoft Excel sync is paused; Supabase continues collecting records and CSV exports are available.
8. A trip that ends by timer remains flagged until an admin confirms physical exit. On **Live vehicle board → Trip exceptions**, **Verify exit** records the admin and verification time in the audit trail without replacing the original timer time. **Review** remains available for corrections when the actual observed exit time is known.

## Deployment

Deploy to a secure HTTPS origin (for camera and geolocation permissions). Vercel is supported. Configure all environment variables in the deployment platform, set `APP_URL` to the deployed origin, add that origin to Supabase Auth settings, and update the Entra redirect URI. Protect the Supabase service key, Entra secret, token encryption key and cron secret. Keep the app and database in a suitable data residency region for your organization.

Before live use, test real Android and iOS devices at the site, verify GPS accuracy and exit timing, validate invited accounts and roles, and test the daily and backup QR with real driver and guard devices. The backup QR is a permanent fallback and can be copied, so keep the print at the gate.

## Checks

Run `npm test`, `npx tsc --noEmit`, `npm run build`, and `npm audit`.
