# Deploying AskUp to Vercel (free)

## Step 1 — Supabase (free database + realtime)

1. Go to https://supabase.com and create a free account
2. Create a new project (choose a region close to your users)
3. Once the project is ready, open the **SQL Editor**
4. Paste the contents of `supabase/schema.sql` and click **Run**
5. Go to **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Step 2 — Deploy to Vercel

### Option A: GitHub (recommended)

1. Push this `askup/` folder to a GitHub repo (can be a new one)
2. Go to https://vercel.com → New Project → Import the repo
3. Set the root directory to the `askup` folder (or repo root if that's where it is)
4. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key
5. Click **Deploy** — done!

### Option B: Vercel CLI

```bash
cd askup
npm install
npx vercel
# Follow the prompts
# When asked about environment variables, add the two Supabase values
```

## Step 3 — Use it!

- **Host a session**: Go to your Vercel URL → "Host a Session" tab
- **Share with interns**: Show them the QR code or the 6-char session code
- **Projector mode**: Click "Projector" in the admin view — go fullscreen on the big screen
- **Export**: Click "Export" to download unanswered questions as CSV after the AMA

## URLs

| Route | Who uses it |
|-------|-------------|
| `/` | Everyone — create or join sessions |
| `/session/[code]` | Participants — submit & upvote questions |
| `/admin/[code]?token=...` | Host only — manage session, see QR, export |
| `/display/[code]` | Projector / big screen display |

## Tips for Google Connect AMA

- Create the session 10 min before it starts so the QR code is ready
- Put the QR code + session code on a slide at the start
- Open `/display/[code]` fullscreen on the presenter laptop
- Use the admin view on your phone to mark questions answered as the speaker responds
- Export unanswered questions at the end and share the CSV with the speaker
