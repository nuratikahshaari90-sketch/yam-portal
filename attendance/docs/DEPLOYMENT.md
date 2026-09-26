# Deploying YAM Staff: step-by-step guide

This guide assumes no technical background. Set aside about **1 hour**. You will create two free online accounts:

| Service | What it does | Cost |
|---|---|---|
| **Supabase** (supabase.com) | Stores all data and photos, handles logins and password reset emails | Free to start. Pro plan (USD 25/month) recommended once live, see Part 7 |
| **Netlify** (netlify.com) | Puts the app on the internet at a web address staff open on their phones | Free |

You also need the **GitHub** account that holds the `yam-portal` repository.

> **Keep a notebook (or password manager) open.** You will copy a few values between screens: a database password, a Project URL, a key and your app's web address.

---

## Part 1: Make sure the code is on GitHub

The app lives in the `attendance` folder of the `yam-portal` repository, on the branch `claude/practical-wright-wbqc7e`.

1. On GitHub, open the repository and check that the branch shows the `attendance` folder.
2. Open a **Pull Request** from that branch into `main` and **Merge** it. (Netlify publishes whatever is on `main`.)

---

## Part 2: Create the database (Supabase)

### 2.1 Create the project
1. Go to **supabase.com** and click **Start your project**. Sign in with GitHub.
2. Click **New project**.
   - **Name:** `yam-staff`
   - **Database password:** click *Generate a password*, then **save it in your password manager**.
   - **Region:** *Southeast Asia (Singapore)*, which is closest to Malaysia.
3. Click **Create new project** and wait about 2 minutes.

### 2.2 Build the database (copy and paste once)
1. On GitHub, open `attendance/supabase/deploy/1_create_database.sql`, click **Raw**, then select all (Ctrl+A / Cmd+A) and copy.
2. In Supabase, click **SQL Editor** (left menu), then **New query**.
3. Paste and click **Run**. You should see **"Success. No rows returned"**.
   *Run this file only once. Running it again shows "already exists" errors. That's harmless, but not needed.*

### 2.3 (Optional) Load sample data to try the app first
Repeat 2.2 with `2_sample_data_optional.sql`. This adds sample staff so you can test every role. The password for all of them is **`YamTest#2026`**:

| Login | Role | Notes |
|---|---|---|
| hr@yam.test | HR/Admin | Approves claims, overtime and attendance exceptions |
| director@yam.test | HR/Admin | Second admin (approves HR's own requests) |
| supervisor@yam.test | Supervisor | Team: Farid and Kavitha |
| farid@yam.test | Staff | Mon–Fri. Has a Kuantan trip, a claim and overtime |
| kavitha@yam.test | Staff | **Weekend roster, Wed–Sun** (from 1 July 2026) |
| meiling@yam.test | Staff | No supervisor, so her requests go to HR. Missed a clock-out |
| newstaff@yam.test | Staff | Registered but not activated, to try **Activate your account** |

### 2.4 Login settings
In Supabase, open **Authentication**:
1. **Sign In / Providers → Email**: make sure *Email* is **enabled** and **Confirm email** is **on**. Set **Minimum password length** to **8**. Save.
2. **URL Configuration**: you will fill this in at step 3.3, once you have the app's web address.

### 2.5 Copy two values for Part 3
Open **Project Settings → Data API** (or **API**):
- **Project URL**, which looks like `https://abcdefgh.supabase.co`
- The **anon / public** key (newer screens call it the **Publishable key**)

> ⚠️ **Never** copy or share the key called **service_role** or **secret**. The app does not need it.

---

## Part 3: Put the app online (Netlify)

### 3.1 Connect Netlify to GitHub
1. Go to **app.netlify.com** and sign up with GitHub.
2. Click **Add new site → Import an existing project → GitHub**. Allow access to the `yam-portal` repository and select it.
3. Fill in the build settings:
   - **Branch to deploy:** `main`
   - **Base directory:** `attendance`
   - **Build command:** `npm run build` (filled in automatically)
   - **Publish directory:** `attendance/dist` (filled in automatically)

### 3.2 Add the two Supabase values
Before clicking Deploy, open **Add environment variables** and add:

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | the Project URL from 2.5 |
| `VITE_SUPABASE_ANON_KEY` | the anon / publishable key from 2.5 |

Click **Deploy**. After 1–2 minutes you get a web address such as `https://yam-staff-123.netlify.app`. You can rename it under **Site configuration → Change site name**, for example `yam-staff.netlify.app`.

*Forgot the variables?* Add them under **Site configuration → Environment variables**, then **Deploys → Trigger deploy**.

### 3.3 Tell Supabase your app's address
Back in Supabase: **Authentication → URL Configuration**
- **Site URL:** your Netlify address, e.g. `https://yam-staff.netlify.app`
- **Redirect URLs → Add URL:** `https://yam-staff.netlify.app/**`

Save. Activation and password-reset emails now open your app.

### 3.4 (Optional) Your own domain
To use an address like `staff.yam.org.my`: in Netlify go to **Domain management → Add a domain** and follow the instructions (your IT/domain provider adds one DNS record). Then update the two URLs in 3.3 to the new address.

---

## Part 4: Reliable emails (recommended before go-live)

Supabase's built-in email service is meant for testing. It sends only a few emails per hour, which can delay activation and password-reset emails. A free sending service fixes this:

1. Create a free account at **brevo.com** (300 emails/day free). Verify the sender address you'll use, e.g. `noreply@yam.org.my`.
2. In Brevo, open **SMTP & API** and note the **SMTP server**, **port**, **login** and **SMTP key**.
3. In Supabase: **Authentication → Emails → SMTP Settings**, turn on **Enable custom SMTP** and enter:
   - Host `smtp-relay.brevo.com`, Port `587`, the Username (login) and Password (SMTP key)
   - Sender email `noreply@yam.org.my`, Sender name `YAM Staff`
4. Optional: under **Email Templates**, adjust the wording of the "Confirm signup" and "Reset password" emails.

---

## Part 5: Go live

1. **Try it** with the sample logins (if you loaded them): clock in and out, apply for leave, request a trip, make a claim, then approve as supervisor and HR. Download a report.
2. **Remove the sample data**: run `3_remove_sample_data.sql` in the SQL Editor. If you uploaded test photos, open **Storage → files** and delete the folders there.
3. **Create the first HR/Admin**: open `4_create_first_hr_admin.sql`, paste it into the SQL Editor, **replace the name and email** with the real HR person's, and Run.
4. The HR person opens the app, taps **Activate your account**, enters that email and chooses a password. They then click the link in the confirmation email.
5. HR then (see the HR guide):
   - **Settings**: check the mileage rate, overtime rules, break and missed-clock-out time.
   - **Public holidays**: check the list against the official gazette and add YAM's state holidays.
   - **Staff**: add every staff member (name, work email, role). Set a work schedule for anyone who works weekends. Supervisors can be assigned later.
   - Add a **second HR/Admin** (for example a director), so someone can approve HR's own leave and claims.
6. Send staff the app link and the staff guide. Each person taps **Activate your account**.

## Part 6: Installing the app on phones

- **Android (Chrome):** open the link, tap **⋮ → Install app** (or *Add to Home screen*).
- **iPhone (must use Safari):** open the link, tap **Share (□↑) → Add to Home Screen**.

It then opens like a normal app, full screen, and works without internet for clocking in and out and for drafts.

---

## Part 7: Costs and looking after it

**Free-plan limits to know about**
- **Pausing:** Supabase pauses free projects after 7 days with no activity. Daily use prevents this. If it ever pauses, log in to Supabase and click **Restore**.
- **Photo storage:** the free plan includes 1 GB for receipts and certificates. At roughly 15 staff × 20 photos a month × 0.3 MB, that is about 90 MB a month, so the free space lasts about 10 months.
- **Backups:** the free plan has **no automatic backups you can restore**.

**My recommendation:** once real data goes in, upgrade Supabase to **Pro (USD 25/month, about RM110)**. You get daily backups, 100 GB of file storage, and no pausing. This is the one cost worth paying: without backups, one mistake or incident could lose attendance and claims records. At minimum, on the free plan, download the monthly Excel reports and keep them in your shared drive.

**Updates.** When a developer changes the app and the change is merged into `main`, Netlify republishes it automatically. Phones pick up the new version the next time the app is opened. If a change needs a database update, the developer will supply a new SQL file to run in the SQL Editor.

**When someone leaves.** HR opens their record in **Staff** and unticks **Active**. They can no longer sign in, and their records are kept.

**Leave balances (next year).** The database was designed for this. Every leave record already stores the leave type, dates and working days taken, so entitlements and balances can be added without changing existing records.

## Troubleshooting

| Problem | Fix |
|---|---|
| App shows a blank page after deploying | The two environment variables are missing or mistyped (3.2). Fix them, then *Trigger deploy*. |
| "This email has not been registered by HR" | HR must add the person in **Staff** first, with exactly that email. |
| Activation/reset email never arrives | Check spam. Set up custom SMTP (Part 4). Check the URLs in 3.3. |
| Reset link opens the wrong site | The Site URL / Redirect URL in 3.3 doesn't match your app address. |
| "Offline, X entries waiting to sync" won't clear | Open **More → Sync status → Sync now** when there is signal. If an entry is shown as "could not be applied", a copy is already with HR under **Sync issues**. |
| Supabase says the project is paused | Log in to Supabase and click **Restore project**. |
