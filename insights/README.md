# Video Insights

A separate app that works with Explainer Studio. Every time Explainer Studio posts a video to
YouTube, Video Insights starts watching it. For four weeks it reads the video's numbers from
YouTube, compares them with the channel's usual videos, and shows a report in plain words:

- **The verdict**: going viral, above usual, about usual or below usual.
- **Why**: the reasons, each with its numbers. For example, viewers left in the first 3 seconds,
  most left during scene 2, or YouTube showed it in the Shorts feed far more than usual.
- **What to try next**: concrete changes for this video or the next one.
- **The analytics**:
  - views over time against your usual video;
  - how long people kept watching, scene by scene;
  - where the views came from and what people searched for;
  - who watched (new viewers or subscribers, countries, ages, devices);
  - likes, comments, shares and new subscribers per view.

Every user who posts through Explainer Studio can use it: each person signs in with the Google
account that owns their channel and sees only that channel.

Open `/sample/viral` and `/sample/slow` to see two sample reports (made-up numbers, real analysis)
before anything is set up.

## How it decides "going viral"

Going viral means much better than *this channel's* usual, not a fixed number of views.

1. **Your usual.** The app takes your last 30 public videos (refreshed each week) and, from
   YouTube's day-by-day numbers, works out how many views each had at every age: after 6 hours,
   1 day, 3 days and so on. Shorts are compared with Shorts and longer videos with longer videos
   when there are at least 3 of the same kind. "Usual" is the **middle (median)** of them at the
   same age, so one old hit or flop doesn't skew it. The chart shades the middle half.
2. **The verdict.** It compares this video's views now with your usual video at the same age:

   | Verdict | When |
   | --- | --- |
   | Going viral | 3× your usual or more, and at least 500 views |
   | Above usual | 1.5× or more |
   | About usual | between 0.67× and 1.5× |
   | Below usual | under 0.67× |
   | Too early to tell | the video is under 6 hours old |
   | No usual yet | the channel has fewer than 3 earlier videos |

   The numbers are in `RULES` in `lib/analyze.ts`.
3. **Speeding up or slowing down**: the views in the last 24 hours, against your usual video
   on the same day of its life.

The reasons come from fixed rules first (`lib/analyze.ts`). Each rule compares one thing with
your usual:

- the first 3 seconds;
- how much of the video people watched;
- the moments many people left, matched to the Studio scene playing then;
- moments people replayed;
- how much of the traffic came from YouTube recommending it (Shorts feed, suggestions, home page);
- links shared outside YouTube;
- search;
- new viewers or subscribers;
- likes, comments, shares and new subscribers per view;
- private or unlisted settings;
- the length of Shorts.

Then, if an OpenAI key is set, OpenAI rewrites those findings in plain words and suggests what
to try. It only sees the findings and their numbers. If it uses a number that isn't in them, its
answer is sent back, and if it still can't answer, the rules' own words are shown. Either way a
report always appears.

## How often it checks

Each video is checked:

- every hour for its first 2 days;
- every 6 hours until day 7;
- then once a day until day 28.

A copy of the report is kept at **Day 1, Day 3, Week 1 and Day 28** (the final one), so you can
see how it changed.

Checks happen in three ways:

- **The scheduler.** On Vercel, `vercel.json` calls `/api/cron` once a day, which is all
  Vercel's free Hobby plan allows. On the Pro plan, change the schedule to `0 * * * *` to check
  hourly. Any other scheduler (for example cron-job.org or a GitHub Action) can call
  `/api/cron` with the header `Authorization: Bearer <CRON_SECRET>`.
- **Opening a report.** If it was last checked more than 15 minutes ago, it checks again.
- **The Check now button**, at most once every 5 minutes.

YouTube's detailed numbers (watch time, retention, traffic sources, audience) usually arrive 1–3
days after a video is posted. Until then the report uses the live view, like and comment counts,
and says so.

## Setup

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
cd insights
```

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `.env.local` (see the table below), then:

```bash
npm run dev
```

Open <http://localhost:3001>. On your own computer the app keeps its data in `insights/.data/`
(a built-in Postgres), so no database is needed.

### Settings

| Variable | Required | What it does |
| --- | --- | --- |
| `AUTH_SECRET` | Yes | A long random value (`openssl rand -base64 32`). Signs the sign-in cookie and encrypts the saved Google permissions. Changing it disconnects every channel. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Yes | From your Google Cloud OAuth client. Explainer Studio's client works. |
| `INSIGHTS_SECRET` | Yes | A long random value. Studio sends it with each upload; set the same value in Studio. |
| `CRON_SECRET` | Yes, online | A long random value. Vercel sends it to `/api/cron` by itself. |
| `DATABASE_URL` | Yes, online | A Postgres address, for example from Neon. Leave blank on your own computer. |
| `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL` | No | Lets OpenAI write the reasons in plain words. Without them the built-in rules write them. |
| `OPENAI_REASONING_EFFORT` | No | `low`, `medium`… Lower is faster and cheaper. |
| `ALLOWED_EMAILS` | No | Who may sign in: addresses and `@domains`, separated by commas. The same format as Studio. Blank means anyone with a channel. |
| `STUDIO_URL` | No | Explainer Studio's address, for the "Open Explainer Studio" link. |

### Google Cloud (once)

In the same Google Cloud project as Explainer Studio:

1. **APIs & Services → Library**: enable **YouTube Data API v3** (already on for Studio) and
   **YouTube Analytics API**.
2. **Google Auth Platform → Data access**: add the scopes
   `https://www.googleapis.com/auth/youtube.readonly` and
   `https://www.googleapis.com/auth/yt-analytics.readonly`. Both are read-only.
3. **Google Auth Platform → Clients**, your web client: add the **Authorized redirect URI**
   `https://<your-insights-address>/api/auth/callback`, and for your own computer
   `http://localhost:3001/api/auth/callback`.
4. **Google Auth Platform → Audience**: while the app is in **Testing**, add each person's
   Google account under **Test users**.

**Important: Google's 7-day limit.** While the Google app is in Testing, permissions expire
after 7 days. The channel then shows "Paused" and its owner has to sign in again. A video is
watched for 28 days, so for uninterrupted reports press **Publish app** on the Audience page and
complete Google's review of the two read-only scopes. The review needs a privacy policy and can
take a few days or weeks.

### Putting it online (Vercel)

1. In [Vercel](https://vercel.com/new), choose **Add New → Project** and import the same
   repository as Explainer Studio. Set **Root Directory** to `insights`.
2. In the new project, open **Storage → Create Database → Neon** (free). Connect it to the
   project; this adds `DATABASE_URL`.
3. Under **Settings → Environment Variables**, add `AUTH_SECRET`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `INSIGHTS_SECRET`, `CRON_SECRET` and any optional settings, then
   deploy.
4. Add the redirect URI from step 3 of the Google setup, using the new address.

### Connecting Explainer Studio

In **Explainer Studio's** settings, add:

- `INSIGHTS_URL`: this app's address, for example `https://explainer-insights.vercel.app`;
- `INSIGHTS_SECRET`: the same value as here.

Then redeploy Studio. After each upload, Studio's YouTube panel shows **See how this video is
doing**. If the channel hasn't connected Video Insights yet, the video waits. When the owner
signs in, every waiting video starts being tracked.

## Privacy and security

- **Read-only.** Video Insights asks Google only to *read* a channel and its analytics. It
  cannot upload, change or delete anything.
- **Each person sees only their own channels**: the channels they connected by signing in with
  the account that owns them.
- **Saved permissions are encrypted** with a key made from `AUTH_SECRET`, so a copy of the
  database alone cannot be used to read anyone's channel.
- **Studio's messages are checked** with `INSIGHTS_SECRET`, compared in constant time. Studio
  only sends a video after YouTube confirmed the upload. Video Insights also checks with YouTube
  that the video really belongs to that channel before it reports on it.
- **Cookies**: the sign-in cookie is signed, HttpOnly, SameSite=Lax and Secure on HTTPS. Forms
  refuse requests from other websites.
- **Disconnect** (on the home page) withdraws the permission at Google and deletes the channel,
  its videos, every check and every report. YouTube's API policies require deleting data when
  access is withdrawn.
- **Nothing secret is logged.**

## Known limits

- **Thumbnail impressions and click-through rate are not available.** YouTube doesn't give them
  to apps through its API, so the report says so and points to YouTube Studio → Analytics →
  Reach.
- **Detailed numbers arrive late.** YouTube's analytics come 1–3 days after posting, so the
  first day's report is based on views, likes and comments.
- **New channels.** With fewer than 3 earlier videos there is no "usual" yet. The report then
  uses YouTube's own comparison with similar videos for how long people watched.
- **Daily checks on the free plan.** Vercel's Hobby plan runs the scheduler once a day. Opening
  a report always brings it up to date.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app on port 3001 |
| `npm run build` then `npm start` | Build and run the production version |
| `npm test` | Run the unit tests |
| `npm run lint` and `npm run typecheck` | Check the code |

## Project map

```
app/
  page.tsx                   Home: sign in, or your channels and videos
  videos/[id]/page.tsx       One video's report, with Day 1 / Day 3 / Week 1 / Day 28 copies
  sample/[kind]/page.tsx     The two sample reports
  api/auth/…                 Google sign-in (start, callback, sign out)
  api/track/route.ts         Explainer Studio tells the app about a new upload
  api/cron/route.ts          The scheduler: checks every video that is due
  api/videos/[id]/check/…    "Check now", and the check when a report is opened
  api/channel/disconnect/…   Withdraws permission and deletes a channel's data
components/
  Report.tsx                 The report: verdict, key numbers, reasons, charts
  LineChart.tsx              Views over time and retention charts (SVG, with a table view)
  Dashboard.tsx              The list of channels and videos
  CheckNow.tsx               "Checked 5 minutes ago · Check now"
lib/
  analyze.ts                 The verdict and the reasons (pure functions; thresholds in RULES)
  baseline.ts                "Your usual": growth curves, medians, Shorts vs longer videos
  advice.ts                  The report in plain words from the rules alone
  ai.ts                      OpenAI's plain-words write-up, checked against the facts
  youtube.ts                 Reading the YouTube Data and Analytics APIs
  pacific.ts                 YouTube's Pacific-time days turned into real hours
  monitor.ts                 One check, the schedule, milestones, and the scheduler's run
  store.ts, db.ts            The database (Postgres online, built-in Postgres locally)
  google.ts, session.ts      Sign-in, cookies, encrypted permissions
  samples.ts                 The two sample videos
tests/                       Unit tests
```
