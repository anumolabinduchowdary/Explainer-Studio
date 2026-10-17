# Explainer Studio

Describe a short awareness or explainer video in a sentence or two. The app turns it into a
clear five-part prompt, asks OpenAI to write it, plays it as an animated video in the browser
and lets you download it.

It is built for people who are not technical: parents, teachers, health educators and NGOs.

There are two sections:

- **Explainer videos**: animated text with simple built-in illustrations.
- **Cartoon stories**: talking characters and backgrounds drawn by AI, with AI voices and
  word-by-word captions. Step 2 is a **story plan** instead of a prompt: a list of the
  characters and places you asked for. See [Cartoon stories](#cartoon-stories).

**How it works**

1. **Describe**: type what the video is about, who it is for and how it should feel, or press
   **Speak instead of typing** and say it in any language.
2. **Prompt**: the app writes a five-part prompt (Act as, Goal, Context, Constraints, Output).
   You can edit every part and see the exact text that will be sent. (Cartoon stories show a
   story plan here instead.)
3. **Video**: OpenAI writes the storyboard. The app draws it with animated text and simple
   illustrations. Edit, reorder, delete or rewrite scenes, then create the video and download.

Explainer videos use OpenAI for text only. Cartoon stories also use OpenAI's image model to
draw the pictures and its speech model for the voices. In both, the video itself is animated
and turned into a video file in your browser, so no video-generation service is needed.

## Setup

You need [Node.js](https://nodejs.org) **22 or newer** (the OpenAI SDK requires it) and an
[OpenAI API key](https://platform.openai.com/api-keys).

```bash
npm install
```

```bash
cp .env.example .env.local
```

Open `.env.local` and paste your key after `OPENAI_API_KEY=`. Then:

```bash
npm run dev
```

Open <http://localhost:3000>.

No key yet? Click **Open a ready-made example video** on the home page to try the player and
the download with the built-in example.

### Settings (`.env.local`)

| Variable | Required | What it does |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes, unless visitors bring their own | Your OpenAI key. Server-side only. |
| `OPENAI_TEXT_MODEL` | Yes | The text model, for example `gpt-6.1-sol` or the cheaper `gpt-6-luna`. Check [OpenAI's model list](https://developers.openai.com/api/docs/models) for current names. |
| `OPENAI_REASONING_EFFORT` | No | `low`, `medium`, `high`… Lower is faster and cheaper. Leave blank for the model's default. |
| `OPENAI_IMAGE_MODEL` | For Cartoon stories | The image model, for example `gpt-image-2.5-flare`. It must support transparent backgrounds. |
| `OPENAI_IMAGE_EDIT_MODEL` | No | Model used to redraw a character with its mouth open. Defaults to `OPENAI_IMAGE_MODEL`. |
| `OPENAI_IMAGE_QUALITY` | No | `low`, `medium` or `high`. Higher costs more and takes longer. |
| `OPENAI_SPEECH_MODEL` | For voices, unless SpeechGen is used | The text-to-speech model, for example `gpt-4o-mini-tts`. |
| `SARVAM_API_KEY` | No (recommended) | Your [Sarvam AI](https://www.sarvam.ai) API key, for real Indian voices in Indian English and ten Indian languages. Server-side only. See [Sarvam AI voices](#sarvam-ai-voices-indian). |
| `SPEECHGEN_API_TOKEN` | No | Your [SpeechGen](https://speechgen.io) API token. Set it together with `SPEECHGEN_EMAIL` to use SpeechGen's voices instead of OpenAI's. Server-side only. See [SpeechGen voices](#speechgen-voices). |
| `SPEECHGEN_EMAIL` | With the token | The email address of the SpeechGen account. |
| `SPEECHGEN_ACCENT` | No | The accent to prefer when a language has several: `Indian` (the default), `US`, `British`… |
| `OPENAI_TRANSCRIBE_MODEL` | For speaking, and the voice check | The speech-to-text model behind "Speak instead of typing" and the voice check, for example `gpt-transcribe`. |
| `OPENAI_VISION_MODEL` | No | The model that checks pictures. Defaults to `OPENAI_TEXT_MODEL`. |
| `OPENAI_MODERATION_MODEL` | No | Defaults to `omni-moderation-latest`. |
| `RATE_LIMIT_PER_MINUTE` | No | Text requests allowed per IP address per minute. Default `10`. |
| `RATE_LIMIT_IMAGES_PER_MINUTE` | No | Pictures allowed per IP address per minute. Default `24`. |
| `RATE_LIMIT_SPEECH_PER_MINUTE` | No | Spoken lines allowed per IP address per minute. Default `60`. |
| `AUTH_SECRET` | To switch sign-in on | A long random value that signs the sign-in cookie. See [Sign-in](#sign-in). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For Google sign-in | From a Google Cloud OAuth client. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | For emailed codes | The mail service that sends the 6-digit codes. |
| `AUTH_EMAIL_FROM` | No | The sender shown on the email. Defaults to `SMTP_USER`. |
| `ALLOWED_EMAILS` | No | Who may sign in: addresses and `@domains`, separated by commas. Blank means anyone. |
| `YOUTUBE_UPLOADS` | For the YouTube button | `on` shows **Upload to YouTube**. Needs Google sign-in. See [Posting to YouTube](#posting-to-youtube). |
| `YOUTUBE_PRIVACY` | No | `public` (default), `unlisted` or `private`. |
| `YOUTUBE_CATEGORY_ID` | No | YouTube category number. Default `27` (Education). |

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app for development |
| `npm run build` then `npm start` | Build and run the production version |
| `npm test` | Run the unit tests |
| `npm run lint` and `npm run typecheck` | Check the code |

## Cartoon stories

A cartoon story is a short conversation between up to six characters, in up to three places.
Up to five characters can be on screen together; a group that is too wide for the frame
stands in two rows, taller people at the back. Each character keeps exactly the same size
in every scene and in both rows: the story is sized once, so that its most crowded scene
fits (neighbours may overlap a little, and nobody is made smaller than 65%), instead of
shrinking people scene by scene (`storyCharacterScale` in `lib/storyRenderer.ts`).

1. **Describe** who is in the story, where it happens and what it should teach, for example
   "4 children in a physiotherapy centre with their physiotherapist".
2. **Plan**: the app turns that into a story plan and shows it for checking:
   - **Characters**: one entry for every person you described (here, four children and one
     adult), each with a name, who they are, an age and what they look like.
   - **Places**: where it happens (here, the physiotherapy centre).
   - **Message**: what the video should teach.
   - **Details**: length, shape, language, tone, anything to include or avoid, and the
     **Drawing style**: the look your description asked for, in plain words (for example
     "soft watercolour cartoon with pastel colours"), or empty for the standard friendly 2D
     cartoon. Every character and place is drawn as a cartoon in this style.

   Change, add or remove anything, then click **Write the story**. OpenAI writes the scenes
   and the lines, and picks a voice for each character. It is not asked for the cast: the
   server copies the characters and places from your plan, so the story always has exactly
   the people and places you agreed to (see [The story plan](#the-story-plan)).
3. Click **Draw the pictures**. For each character the image model draws a cut-out with a
   transparent background, then a second version with the mouth open. For each place it draws
   a background. The app places the characters in the background, makes the speaker bounce
   and move their mouth, and shows the words as large captions.
4. Click **Record the voices**. Each line is spoken by an AI voice. The story gives every
   character a voice (grouped into women's and men's voices), an age and a manner of speaking
   ("cheerful, quick and proud"); change any of them and press **Listen** to compare. The speaker's mouth then follows the loudness of the
   voice, the captions follow its timing, and the sound is included in the downloaded video.
5. Edit names, descriptions, lines and who is on screen; redraw any picture; then record.

Things to know:

- **Hand gestures**: with "Hand gestures while talking" ticked (the default), each character
  is also drawn with a hand raised and with both hands open, each with the mouth open too.
  While someone speaks they move between these poses in stretches of a second or two that
  start with a word, blending smoothly from one pose to the next, with rests in between. The
  people listening nod along. The pattern is fixed for each line, so the preview and the
  downloaded video match. Untick it for the whole story, or per character, if a gesture
  drawing looks wrong.
- **Cost**: each character needs 6 pictures with gestures (2 without) and each background 1,
  so a story with 3 characters and 3 places is 21 pictures (9 without gestures), and one with
  5 characters and 1 place is 31. The plan shows this number before anything is written.
  Nothing is drawn until you click the button. See
  [OpenAI's pricing](https://openai.com/api/pricing/) for the cost per picture.
- **Check every picture.** AI drawings can get details wrong, for example hands or the shape
  of a wheelchair or walker. Edit the description and redraw until it is right.
- **Characters can drift.** Each picture is drawn separately from the same description, so the
  mouth-open version can differ slightly from the first. If it looks wrong, untick
  "Mouth moves when talking" for that character; they will bounce while speaking instead.
- **Pictures are not saved.** They live in the page's memory, like everything else. Reloading
  the page clears them, and they would need to be drawn (and paid for) again.
- **Say that the voices are AI.** OpenAI requires a clear statement to listeners that the
  voices are AI-generated and not real people, and it is good practice with any voice service. Put it in the caption or description wherever
  you share the video.
- **Voices cost per line.** One request per spoken line, so about 15 for the example story.
  Editing a line, or changing a character's voice, means recording that line again.
- **Natural, human-sounding voices.** Each line is voiced like an actor would say it, not
  read aloud: the voice is told who the character is, how they sound, and how this particular
  line is said. The story writer adds a short note to every line ("proud and excited",
  "gently reassuring"), which you can change in the scene editor under **How it is said**. A
  line written as a question is answered a little sooner, as in real conversation. OpenAI
  names `marin` and `cedar` as its most natural voices, so the writer gives them to the
  characters who speak most, then `coral`, `sage`, `ash`, `verse` and `ballad`; the older,
  flatter voices are used only when those are taken.
- **Indian accent in every language.** OpenAI's voices sound American unless told otherwise,
  so every line is asked for an Indian accent (`accentDirection` in `lib/server/speech.ts`):
  English as natural Indian English, with Indian names and words said the Indian way; Hindi,
  Telugu and the other Indian languages as a native speaker from India; and any other language
  the way a fluent speaker from India would say it. The accent is acted by
  the voice, so it is only partly Indian; [Sarvam AI voices](#sarvam-ai-voices-indian) are
  real Indian voices and sound far more natural for Indian families.
- **Children and older people.** With [SpeechGen voices](#speechgen-voices) switched on,
  English stories use real children's and older voices. OpenAI's 13 voices are all adults. The **Age** setting
  (Child, Teenager, Adult, Older person) gets closer in two ways at once: the voice is asked
  to act that age, and the recording is played back a little faster or slower, which raises
  or lowers its pitch (a child about 12% higher, a teenager 4% higher, an older person 5%
  lower). Bigger shifts sound artificial, so they are kept small. The result is a cartoon
  child or elder, not a real one. Listen before you publish, and
  try another voice if it does not fit. The amounts are set in `VOICE_AGE_SETTINGS` in
  `lib/story.ts`.
- **Languages.** The voices speak the language the lines are written in. OpenAI documents its
  voices as speaking English, Hindi, Tamil, Kannada, Marathi and Urdu (among others) well,
  but not Telugu, Malayalam, Bengali, Gujarati, Punjabi or Odia; for those the Voices panel
  shows a warning, and [SpeechGen voices](#speechgen-voices) are the better choice. See
  [Languages](#languages).
- **Captions are timed by estimate.** The speech service does not say when each word is
  spoken, so the captions are spread across each line by word length.
- **Make your own cast.** Describe looks in plain words. Do not ask for the style of a named
  artist, channel or existing cartoon character.

## Deploying to Vercel

1. Put the project in a Git repository and push it to GitHub, GitLab or Bitbucket.
   `.env.local` is ignored by Git, so your key stays on your computer.
2. In [Vercel](https://vercel.com/new), choose **Add New → Project** and import the repository.
   Vercel detects Next.js; keep the default build settings.
3. Under **Environment Variables**, add `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL` and, for
   Cartoon stories, `OPENAI_IMAGE_MODEL` (plus any optional settings from the table above).
   To make people sign in before they can use it, add the [sign-in](#sign-in) settings too.
4. Click **Deploy**.

Good to know:

- **Node version**: `package.json` asks for Node 22 or newer, which Vercel picks up.
- **Time limit**: the text routes allow up to 60 seconds and the picture route up to 120
  seconds (`maxDuration`). The 120-second limit needs Vercel's Fluid compute, which is on by
  default for new projects. If text requests time out, set `OPENAI_REASONING_EFFORT=low` or
  use a faster model; if pictures time out, lower `OPENAI_IMAGE_QUALITY`.
- **Changing settings**: after editing environment variables in Vercel, redeploy.
- **Rate limiting**: the built-in limiter keeps its counters in memory. On Vercel each server
  instance counts separately, so treat it as a speed bump. For a strict limit, add Vercel's
  firewall rate limiting or swap `lib/server/rateLimit.ts` for a shared store such as Redis.
- **Spending**: set a monthly budget in your OpenAI account so a busy day cannot surprise you.

## Sign-in

By default anyone with the link can use the app, and so can spend your OpenAI and SpeechGen
credit. Sign-in closes it: people must sign in before they see the app, and every API route
refuses requests from anyone who has not.

There are two ways to sign in, and you can switch on either or both:

- **Continue with Google.**
- **A 6-digit code sent by email.** No password to remember.

There are no passwords and no database. After signing in, the browser holds a signed cookie
that says who is signed in. It lasts 30 days.

### Switching it on

Add these in Vercel under **Settings → Environment Variables** (or in `.env.local` on your own
computer), then redeploy. Never paste any of these values into the page, a chat or the code.

**1. A secret for the cookie (always needed).** Make one with:

```bash
openssl rand -base64 32
```

Save the result as `AUTH_SECRET`.

**2. Google sign-in.**

1. Open the [Google Cloud console](https://console.cloud.google.com/), create a project, and go
   to **Google Auth Platform**.
2. Fill in **Branding** (app name and your email) and set **Audience** to **External**. The app
   only asks Google for a person's name and email address, so no test users or review are
   needed.
3. On **Clients**, click **Create client** and choose **Web application**.
4. Under **Authorized redirect URIs** add your site's address followed by
   `/api/auth/google/callback`, for example
   `https://explainer-studio-five.vercel.app/api/auth/google/callback`. It must match exactly.
   For your own computer also add `http://localhost:3000/api/auth/google/callback`.
5. Save the **Client ID** as `GOOGLE_CLIENT_ID` and the **Client secret** as
   `GOOGLE_CLIENT_SECRET`.

**3. Emailed codes.** The app sends the email through any mail service that offers SMTP.

- *With a Gmail account (no domain needed):* turn on 2-Step Verification for the account, then
  create an **app password** at <https://myaccount.google.com/apppasswords>. Set
  `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER` to the Gmail address and
  `SMTP_PASSWORD` to the 16-character app password (not your normal Gmail password). Gmail
  allows a few hundred emails a day, and work or school Google accounts may not offer app
  passwords.
- *With a sending service such as Resend or Brevo:* use the SMTP details it gives you, and set
  `AUTH_EMAIL_FROM` to an address on a domain you have verified with it. These services need
  a domain you own.

**4. Who may sign in (recommended).** Set `ALLOWED_EMAILS` to the people you approve, for
example `ana@example.org, ben@gmail.com, @myschool.edu`. An entry starting with `@` approves
everyone at that domain. If you leave it blank, anyone with a Google account or an email
address can sign in and use your credit.

To switch sign-in off again, remove all of these settings. If only some are present the app
stays closed and the page says which setting is missing.

### How it protects the app

- **Checked on the server, every time.** The home page and every route under `app/api/` check
  the cookie on the server (`lib/server/auth/session.ts`, `lib/server/handler.ts`). Hiding the
  page is not relied on.
- **The cookie** is `HttpOnly` (scripts on the page cannot read it), `Secure` on HTTPS and
  `SameSite=Lax`, and is signed with `AUTH_SECRET`, so it cannot be forged or edited.
- **Removing someone** from `ALLOWED_EMAILS` (and redeploying) signs them out at once: the list
  is checked on every request.
- **Google sign-in** uses the standard OpenID Connect flow with PKCE, a one-off state and
  nonce, and checks Google's signature on the reply. Only addresses Google has verified are
  accepted.
- **Email codes** are 6 random digits that work for 10 minutes. The code itself is only in the
  email: the browser holds a keyed fingerprint of it that is useless without the server's
  secret. Signing in needs the same browser that asked for the code.
- **Guessing is limited**: 5 tries per address in 10 minutes, 3 codes per address in 10
  minutes, and per-IP limits on top. An address that is not approved is sent nothing and sees
  the same screen as everyone else.
- **Nothing is logged** about who signs in: no addresses, codes or cookies.

Limits worth knowing:

- **Signing out** removes the cookie from that browser. There is no server-side list of
  sessions, so a cookie that was copied elsewhere beforehand keeps working until it expires.
  To cut off everyone at once, change `AUTH_SECRET`.
- **The guess and send limits are held in memory**, like the other rate limits, so on Vercel
  each server instance counts separately. For strict limits use a shared store (see
  [Deploying to Vercel](#deploying-to-vercel)).
- **Videos are still not saved.** Signing in controls who can use the app; it does not give
  people an account that stores their work.

## Keeping the API key safe

- `OPENAI_API_KEY` is read only on the server (`lib/server/handler.ts`). It is never sent to
  the browser and never written to logs. The home page only learns *whether* a key exists.
- Every OpenAI call goes through the server routes in `app/api/`.
- The Sarvam AI key (`SARVAM_API_KEY`) and the SpeechGen token (`SPEECHGEN_API_TOKEN`), if
  you use them, are handled the same way: read on the server only, sent to the voice service
  with each request from the server (Sarvam in a request header, SpeechGen in the body of a
  POST request), and never logged, put in a web address or sent to the browser. Visitors
  cannot supply their own.
- **Use my own key** (the "API key" button): the key is kept in the page's memory only. It is
  not saved to localStorage, cookies or the URL. It is sent over HTTPS in a request header,
  used for that one request and then discarded. The server refuses it over plain HTTP (except
  on `localhost`).
- Error messages from OpenAI, Sarvam AI and SpeechGen are never passed through to users or logs,
  because they can repeat part of a key.
- The sign-in secrets (`AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `SMTP_PASSWORD`) are also read on
  the server only and never logged. See [Sign-in](#sign-in).

## Sharing to Instagram, YouTube and other apps

When a video has been recorded, the Download panel shows a **Share** section:

- A suggested caption (the title, the health disclaimer and AI-voice statement where they
  apply, and the account to follow). Edit it, or press **Copy caption**.
- On a phone, **Share to Instagram, YouTube…** opens the phone's own share menu with the
  video attached. Choose the app, paste the caption and post. The caption is copied
  automatically because most apps ignore text sent along with a video.
- On a computer the share menu rarely lists those apps, so download the video and upload it.

This uses the browser's built-in sharing, so the app never holds anyone's Instagram login.
For YouTube there is also a direct button: see [Posting to YouTube](#posting-to-youtube).

## Posting to YouTube

With YouTube uploads switched on, the Download panel shows a **YouTube** section once the video
file has been made.

- **Connect YouTube** (once): a small Google window asks for permission to upload to your
  channel. After that the browser remembers the connection.
- **Upload to YouTube** (one press): the app
  1. writes a title, description, hashtags and tags from the video's own words, in the
     video's language (the AI is told to stay accurate and not to promise results);
  2. adds the lines every video carries: the health disclaimer for health videos, "The
     voices in this video are AI-generated." when there are AI voices, and the account to
     follow;
  3. makes a 1280×720 thumbnail: for cartoon stories, the scene with the most people in it,
     drawn wide, with the title in large letters; for explainer videos, the first scene drawn
     wide, also with the title in large letters;
  4. sends the video to YouTube in 4 MB pieces through the app's server, then sets the
     thumbnail;
  5. shows **Watch on YouTube** and **Edit in YouTube Studio** links, the thumbnail, and the
     title and description it used.

Videos go up as **public** in the **Education** category. The app does not set YouTube's "made
for kids" setting, so YouTube uses your channel's own audience setting (YouTube Studio →
Settings → Channel → Advanced settings). Set it there once; if it is not set, YouTube may ask
in Studio.

### Switching it on

YouTube uploads use Google sign-in, so set up [Sign-in](#sign-in) with Google first. Then, in
the same Google Cloud project:

1. **APIs & Services → Library**: enable **YouTube Data API v3**.
2. **Google Auth Platform → Data access**: add the scope
   `https://www.googleapis.com/auth/youtube.upload`.
3. **Google Auth Platform → Clients**, your web client: add a second **Authorized redirect
   URI**: `https://explainer-studio-five.vercel.app/api/youtube/callback` (and
   `http://localhost:3000/api/youtube/callback` for your own computer).
4. **Google Auth Platform → Audience**: while the app's status is **Testing**, add the Google
   account that owns your channel under **Test users**.
5. In Vercel, add `YOUTUBE_UPLOADS=on`, then redeploy.

Optional settings: `YOUTUBE_PRIVACY` (`public`, the default, or `unlisted` or `private`) and
`YOUTUBE_CATEGORY_ID` (`27`, Education, by default).

### Things to know

- **Reconnecting every 7 days.** Google limits apps in Testing status: permission to upload
  lasts 7 days, then the app asks you to connect again. To stop this, press **Publish app** on
  the Audience page and complete Google's review of the upload permission (it needs a privacy
  policy and can take a few days or weeks).
- **100 uploads a day.** YouTube allows up to 100 uploads a day through an app's API access
  (its documentation lists videos.insert as 100 calls per day).
- **Custom thumbnails** may need your channel to be verified by phone in YouTube Studio. If
  YouTube refuses the thumbnail, the video is still posted and the panel says why. For Shorts
  (vertical videos up to three minutes), YouTube may show a frame of its own choosing in the
  Shorts feed.
- **Who can post where.** Anyone who can sign in to the app can connect their own channel;
  each browser posts only to the channel connected in it. While the Google app is in Testing,
  only its test users can connect at all.
- **Keeping the permission safe.** The permission (a Google refresh token) is kept in your
  browser in an HttpOnly cookie, encrypted with a key made from `AUTH_SECRET`, and only sent to
  the app's YouTube routes. Scripts on the page cannot read it, and every request to YouTube
  is made by the server. **Disconnect** withdraws it at Google too. Changing `AUTH_SECRET`
  disconnects everyone.
- **Large videos** are sent in 4 MB pieces, so they fit the hosting platform's request size
  limit. A piece that fails is tried again; keep the page open until it says "Posted".

## How the video file is made

**Create video** builds the file one frame at a time: each frame is drawn at its exact moment
and encoded, and the voices are mixed into a single sound track. Nothing depends on how fast
the device is or whether the screen stays on, so the picture cannot freeze while the sound
carries on.

- The result is a standard MP4: H.264 picture at a steady 30 frames a second, AAC sound, with
  its index at the front. Phones, WhatsApp, Instagram and YouTube all accept this kind.
- It is usually faster than the video's length. On the development laptop a 2-minute video
  took about 20 seconds; phones will be slower.
- Size is roughly 20 MB a minute.
- The MP4 is written by [Mediabunny](https://mediabunny.dev) (MPL-2.0 licence), using the
  browser's own video encoder (WebCodecs). The code is in `lib/exportVideo.ts`.

## The closing card

Videos about special parenting, in both sections, end with a 4-second closing card showing
the Special Parenting Instagram QR code. Other videos (a Ramayan story, a festival, general
knowledge) end without it.

- **How it is decided.** While planning a cartoon story or writing an explainer storyboard,
  the AI also answers whether the video is about special parenting: children with
  disabilities, developmental differences or special needs; their therapy; inclusive
  schools; early checks such as baby hearing tests; or support for their parents and
  caregivers. General parenting or child health that is not about special needs does not
  count. Social Stories and home exercise programmes always count. The answer costs nothing
  extra: it comes back with the plan or storyboard.
- **Changing it.** The **End with our Instagram QR code** box on the video screen starts
  ticked or unticked from that answer; tick or untick it for any video.
- **The account line goes with it.** "Follow @specialparenting for more." is added to the
  suggested share caption and the YouTube description only when the video ends with the QR
  card.

To use a different picture, replace `public/end-card.webp` (any image works). The length and
the screen-reader description are set in `lib/endCard.ts`.

## Speaking instead of typing

Both Describe screens have a **Speak instead of typing** button. It records up to a minute
from the microphone, sends the recording to OpenAI to be written down, and adds the words to
the text box, where they can be corrected before building the prompt.

- The browser asks for permission to use the microphone the first time. Microphones only work
  on `https://` sites and on `localhost`.
- The recording is passed to OpenAI and is not stored by this app.
- The language is detected automatically.
- The button does not appear in browsers that cannot record sound.

### Sarvam AI voices (Indian)

OpenAI's voices are American at heart: asked for an Indian accent they change only a little.
[Sarvam AI](https://www.sarvam.ai) is an Indian company whose voices (Bulbul v3) are real
Indian voices, made for Indian English and ten Indian languages: Hindi, Bengali, Tamil,
Telugu, Gujarati, Kannada, Malayalam, Marathi, Punjabi and Odia. To use it:

1. Sign up at [dashboard.sarvam.ai](https://dashboard.sarvam.ai) and create an API key. New
   accounts get free credit.
2. Add `SARVAM_API_KEY` to the server settings: in Vercel under **Settings → Environment
   Variables**, or in `.env.local` on your own computer. Never paste the key into the page, a
   chat or the code.
3. Redeploy (or restart the app).

Then:

- Every story in one of those languages is spoken by Sarvam. The Voices panel lists its 37
  voices (14 women's, 23 men's) and says the lines are charged to the Sarvam AI account.
  Stories already cast with OpenAI's voices are given Sarvam voices of the same gender,
  best first (Sarvam recommends Ishita, Priya and Shubh). Varun is deep and dramatic, good
  for a villain.
- A story in another language (for example French) keeps OpenAI's voices.
- All of Sarvam's voices are adults. For a child or an older person the recording's pitch is
  raised or lowered, as with OpenAI's voices, and Sarvam is asked to speak a little slower
  to make up for it.
- Sarvam does not take acting notes, so the **How it is said** notes and the manner of
  speaking are not used; its voices already speak with natural Indian rhythm.
- Every line is still screened by OpenAI's moderation and listened back by the voice check
  (`OPENAI_TRANSCRIBE_MODEL`).
- Cost: about ₹30 for every 10,000 characters (Sarvam's pricing page), so a one-minute story
  costs a few rupees.
- Remove `SARVAM_API_KEY` to go back to OpenAI's (or SpeechGen's) voices. If both Sarvam and
  SpeechGen are set up, Sarvam is used for the languages it speaks.

### SpeechGen voices

OpenAI's voices are all adults. [SpeechGen](https://speechgen.io) has real children's voices
(girls and boys) and older voices in English, and voices for Hindi, Telugu, Tamil and many
other languages. To use it:

1. Get the API token from your SpeechGen profile page.
2. Add `SPEECHGEN_API_TOKEN` and `SPEECHGEN_EMAIL` (the email you log in to SpeechGen with) to
   the server settings: in Vercel under **Settings → Environment Variables**, or in
   `.env.local` on your own computer. Never paste the token into the page, a chat or the code.
3. Redeploy (or restart the app).

The Voices panel then lists SpeechGen's voices for the story's language and each line is
charged to the SpeechGen account. Remove the two settings to go back to OpenAI's voices.

How voices are chosen:

- The list is narrowed to the story's language, in the accent set by `SPEECHGEN_ACCENT`
  (`Indian` by default, so an English story gets English (Indian) voices).
- **One accent for the whole story.** Children and older people are given voices from the
  story's own accent (English (Indian) for an English story), made younger or older: the pitch
  is raised for a child and lowered for an older person, as it is with OpenAI's voices. Real
  children's and older voices exist only in American, British and Australian English; they
  are still listed in the Voices panel (marked with their accent) if you want to choose one by
  hand, and a voice chosen by hand is kept.
- Languages without children's voices (Hindi, Telugu, Tamil…) work the same way.
- Everyone gets a different voice while there are enough to go round. You can change any
  voice and press **Listen**.

Things to know:

- Each line's text is sent to SpeechGen to be spoken. Lines are still screened by OpenAI's
  moderation first, so an OpenAI key is needed as before.
- SpeechGen has no "manner of speaking" instruction. The "How they sound" box is used only
  when the chosen voice has a matching style, such as "cheerful".
- Voices differ in price; SpeechGen's own site lists the cost of each.
- The token is sent to SpeechGen in the body of each request from the server. It is never
  logged, put in a web address or sent to the browser (`lib/server/speechgen.ts`).

### The story plan

Earlier versions used the five-part prompt for cartoon stories too. The cast was then only a
sentence inside the prompt, so "4 children and a physiotherapist" could come back as two or
three characters. Now:

- `POST /api/plan` turns the description into the plan (`lib/plan.ts`). The instructions tell
  the model to create exactly the people described, one character each, and exactly the
  place named.
- `POST /api/story` takes the plan. The model returns only the title, the scenes, the lines
  and a voice for each character id. `buildStoryFromPlan` (`lib/server/normalizePlan.ts`)
  then builds the story around the plan's own characters and places. A line given to someone
  who is not in the plan is read by the narrator, and anyone the script forgot is still put
  on screen.
- A character's age sets their size on screen and the age of their voice.
- The edited plan goes through moderation again before the story is written.

## Social Stories and home exercise programmes

On the Describe step of **Cartoon stories**, choose what to make:

- **Cartoon story**: characters talk through a topic (everything above).
- **Social Story**: a short, calm story that prepares one autistic child for a situation,
  such as going to the dentist, a haircut or the first day at a new school.
- **Home exercise programme**: a therapist's exercises turned into a video the family can
  follow at home.

### Social Stories

Describe the situation, then fill in **The child this story is for**: a first name, the age,
how the child looks, and (optional) what helps, for example a favourite toy or ear defenders.
No photo is used or stored: the child is drawn as a cartoon from your words.

The story follows the usual Social Story guidance:

- It is told by the child, in the first person ("I am going to the dentist"). Other people
  say at most one short, kind line each.
- It describes what will happen, in order, and what the child may see, hear and feel, before
  it suggests anything to do. There are at least twice as many describing or reassuring lines
  as lines that suggest an action.
- It uses positive, literal words: no idioms, jokes, "always" or "never", and at most 12
  words per line. It ends on a calm, positive note.
- **Calm, sensory-friendly** is on: no flash between scenes, captions appear without popping,
  movement is gentler (about 40%), and there is an extra half-second pause after every line.
  The plan step has a **Calm, sensory-friendly** checkbox, so any cartoon story can use it.

### Home exercise programmes

Describe the programme, say who it is for, and paste the therapist's exercises, one per line,
for example:

```
Bridge: lie on your back, knees bent, lift your hips and hold for 5 seconds. 10 times.
Sit to stand: from a chair, stand up without using your hands. 8 times, 2 rounds.
```

- The plan lists every exercise (up to 8) with its name, how to do it, how much, what the
  picture shows and any safety note. The instructions and amounts are kept exactly as the
  therapist wrote them; the AI is told never to add exercises, steps, doses or advice.
  Check and edit them on the plan.
- The video opens with a short welcome, gives each exercise its own scene in the therapist's
  order, and ends with encouragement. The server checks this: an exercise the script left out
  is added back as a scene where the therapist reads the steps, so none is ever lost.
- During each exercise a **card** is shown above the characters: an instruction picture, the
  name, the amount ("10 times") and the safety note. In tall videos the picture is on top; in
  wide and square videos it is on the left. Each exercise picture is drawn once (1024×1024)
  and checked against its description like the other pictures.
- The disclaimer "For awareness, not medical advice." is added as for any health video.

## Languages

**Choosing the language.** The Describe step has a **Language of the video** list (English,
Hindi, Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia, or
"Another language…" to type any other). Leave it on **Same as I write** to get the language
the description is written in. For cartoon stories the language is also part of the plan,
where it can be changed before the story is written.

**Making a video in another language.** On the video page, the **Language** panel makes a
version of the finished video in another language: choose the language and press
**Translate**. Only the words are translated, in one request, so:

- the pictures, characters, scenes and timing stay as they are, with nothing to redraw;
- cartoon stories need their voices recorded again, and the voice list switches to the new
  language;
- each language's version is kept while the page is open, with its own recorded voices, and
  the buttons under **Versions** switch between them. Download each one you want to keep.

The translation is asked to sound like natural speech in that language, to keep names, facts
and respectful wording, and to fit the same space on screen. The health disclaimer is put
back in the new language followed by the English sentence (see below). As with everything
the AI writes, please have a native speaker check a translation before sharing it.

**The health disclaimer in other languages.** Health videos always end with "For awareness,
not medical advice." In a video in another language it is shown (and, in cartoon stories,
spoken by the narrator) first in that language and then in English, for example
"जागरूकता के लिए, चिकित्सीय सलाह नहीं। For awareness, not medical advice." The app has its
own translations for the languages in its list (`lib/disclaimer.ts`); for any other language
the AI translates the sentence. The English sentence is always there. The app's translations
should be checked by a native speaker of each language; they are easy to correct in that
file. YouTube descriptions carry both lines too.

**Fonts.** Captions and on-screen text in Indian scripts use the Baloo family of fonts (the
same rounded design as the English text, in Devanagari, Telugu, Tamil, Kannada, Malayalam,
Bengali, Gujarati, Gurmukhi and Odia scripts), in the app and in the downloaded video. Each is
only downloaded when text in that script is shown.

## Quality checks: ready to post without editing

Every video is checked automatically, and the **Quality check** panel on the video page shows
what was checked and fixed. When everything passes it says **Ready to post**.

- **Facts and wording**, as soon as a script is written: an AI health editor looks for claims
  that are wrong, unproven or exaggerated, promises of results, diagnoses or doses, and
  disrespectful wording. It fixes them by removing or softening, never by adding new facts,
  and the panel lists each change and why. It also picks up to three organisations where
  viewers can learn more, only from a fixed list of trusted bodies in `lib/quality.ts` (WHO,
  UNICEF, the Indian Academy of Pediatrics, the Ministry of Health and Family Welfare,
  NIMHANS, the Rehabilitation Council of India and others), so it can never invent a source or
  a link. These go under "Learn more" in the YouTube description. A new language version is
  checked by itself as soon as it is translated, and each version keeps its own result when
  you switch between them. After you edit the words, the panel offers **Check again**.
- **Pictures** (cartoon stories): each character's standing pose, each background and each
  exercise picture is shown to the AI with its description. If something important is wrong (for example a
  wheelchair without wheels, the wrong age, text in the picture), it is redrawn with the
  correction, at most twice. The other poses are drawn from the corrected one.
- **Voices** (cartoon stories): each recorded line is turned back into text with
  speech-to-text and compared with the script. If the words did not come out right, the line
  is recorded again with a request for clearer speech, and the better take is kept. This needs
  `OPENAI_TRANSCRIBE_MODEL`; without it the voice check is skipped.
- **Make my video** (cartoon stories) does everything in one press: draws and checks the
  pictures, records and checks the voices, and creates the video file.

What the checks cannot promise: they catch clear mistakes, not every subtle one. For health
videos, an expert's review is still the best final step.

The AI that looks at pictures is the text model by default; set `OPENAI_VISION_MODEL` to use
another. Each check is an extra request to OpenAI: one per text check, one per picture
(plus redraws when needed) and one speech-to-text request per line.

## Safety and quality

- **Moderation**: everything people type goes through OpenAI's moderation endpoint before any
  text is generated, including the edited prompt, the edited story plan and rewrite notes.
- **Validation**: every model answer is requested with Structured Outputs and then checked
  with Zod. If it fails, the app retries once and then shows a friendly error.
- **Respectful language**: the storyboard instructions ask for accurate, respectful, inclusive
  and non-sensational wording (`lib/server/systemPrompts.ts`).
- **Health videos**: the server makes sure the last scene ends with
  "For awareness, not medical advice." even if the model forgets. In other languages the
  sentence comes first in that language, then in English.
- **Illustrations**: a storyboard can only use the 23 illustration IDs in `lib/visuals.ts`.
- AI can still get facts wrong. Please review every script before sharing it.

## Example

`examples/` holds one worked example for this description:

> A 2-minute vertical video explaining cerebral palsy to parents in India, warm and hopeful,
> showing children with different abilities.

- [`examples/cerebral-palsy.prompt.json`](examples/cerebral-palsy.prompt.json): the five-part prompt
- [`examples/cerebral-palsy.storyboard.json`](examples/cerebral-palsy.storyboard.json): the 12-scene, 120-second storyboard
- [`examples/cerebral-palsy.plan.json`](examples/cerebral-palsy.plan.json): the story plan for a cartoon story on the same topic, with 3 characters and 3 places
- [`examples/cerebral-palsy.story.json`](examples/cerebral-palsy.story.json): the cartoon story written from that plan, in 5 scenes

These files were written by hand to show the exact formats the app uses. They are not saved
OpenAI responses, and a real run will word things differently. They also power the
"ready-made example" in each section. The example story has no pictures: those are only drawn
with a key.

The storyboard shape:

```json
{
  "title": "Understanding Cerebral Palsy",
  "aspectRatio": "9:16",
  "scenes": [
    {
      "id": "s1",
      "durationSec": 8,
      "heading": "Understanding Cerebral Palsy",
      "body": "A short guide for parents and families.",
      "bullets": [],
      "visual": "family",
      "transition": "fade"
    }
  ]
}
```

`aspectRatio` is `9:16`, `16:9` or `1:1`. `transition` is `fade`, `slide-left`, `slide-up` or
`zoom`. `visual` is one ID from the illustration library.

## Project map

```
app/
  page.tsx                 Home page (checks sign-in and whether a server key exists)
  signin/page.tsx          Sign-in page: Google, or a code sent by email
  api/auth/…               Sign-in routes: Google start and return, email code, sign out
  layout.tsx, globals.css  Fonts, colours and base styles
  api/prompt/route.ts      Description -> five-part prompt, or up to 3 questions
  api/storyboard/route.ts  Five-part prompt -> storyboard
  api/scene/route.ts       Rewrite one scene
  api/plan/route.ts        Description -> story plan (characters, places, message, details)
  api/story/route.ts       Story plan -> cartoon story script
  api/image/route.ts       Draw one picture (character, talking pose or background)
  api/speech/route.ts      Speak one line in a character's voice (OpenAI or SpeechGen)
  api/voices/route.ts      The voices that can be chosen for a story's language
  api/translate/route.ts   A finished video's words in another language
  api/youtube/…            YouTube: connect, upload in pieces, thumbnail, title and description
  api/check/facts/…        Checks and fixes a script's facts and wording; picks trusted sources
  api/check/picture/…      Compares a drawing with its description
  api/transcribe/route.ts  Write down a spoken description
components/
  AppShell.tsx             Header, the two section tabs, API key panel
  Studio.tsx               The three-step flow and its state, for one section
  DescribeStep.tsx         Text box, example chips, clarifying questions
  StoryKindFields.tsx      Cartoon story, Social Story or home exercises, and their extra fields
  SpeakButton.tsx          Microphone button: record, send, add the words to the text box
  PromptStep.tsx           Explainer step 2: five editable cards, live preview, Copy
  PlanStep.tsx             Cartoon step 2: the characters, places, exercises, message and details
  LanguagePicker.tsx       Choose a language from the list, or type another
  LanguagePanel.tsx        A finished video's language, and versions in other languages
  YouTubePanel.tsx         Connect YouTube, Upload to YouTube, progress and the link
  QualityPanel.tsx         What was checked and fixed, and "Ready to post"
  VideoStep.tsx            Explainer step 3: player, scene editor, recording
  StoryStep.tsx            Cartoon step 3: draws pictures, player, recording
  StoryPictures.tsx        Characters and backgrounds: describe, draw, redraw
  StoryVoices.tsx          Voices: choose, listen, record the lines
  StoryScenes.tsx          Cartoon scenes: who is on screen and what they say
  Player.tsx               Canvas player and controls (shared by both sections)
  SceneList.tsx            Edit, reorder, delete, rewrite scenes
  ExportPanel.tsx          Video, .json and .txt downloads
  SharePanel.tsx           Caption and the Share button for a finished video
  ApiKeyPanel.tsx          "Use my own key"
  SignInForm.tsx           The sign-in card: Google button, email and code boxes
lib/
  schemas.ts               Zod schemas for prompts, storyboards and the API
  prompt.ts                The five parts and how they are assembled
  plan.ts                  The story plan: its format, limits and plain-text version
  visuals.ts, visualArt.ts The illustration library (IDs and SVG artwork)
  renderer.ts              Draws any moment of a storyboard on a canvas
  story.ts                 Cartoon story format, timing and caption rules
  storyRenderer.ts         Draws any moment of a cartoon story on a canvas
  voices.ts                Voice lists, and giving each character a voice of the right gender and age
  sarvam.ts                Sarvam AI's Indian voices and languages (the server part is in server/sarvam.ts)
  languages.ts             The language list, and which languages OpenAI's voices speak well
  translate.ts             Taking a video's words out for translation and putting them back
  disclaimer.ts            The health disclaimer in each language, followed by the English
  youtube.ts               Sending a video to YouTube in pieces; the shapes the YouTube routes use
  thumbnail.ts             1280×720 thumbnails with the title in large letters
  quality.ts               Trusted sources, and the shapes of the fact, picture and voice checks
  checks.ts                Runs the fact and picture checks from the browser
  storyPictures.ts         Requests pictures and voices and prepares pictures for drawing
  storyAudio.ts            Plays voice clips in step with the picture and feeds the recording
  endCard.ts               The closing QR card added to the end of every video
  exportVideo.ts           Builds the MP4 frame by frame (WebCodecs + Mediabunny)
  recorder.ts              Fallback for older browsers: records the player live
  api.ts                   Browser-side fetch with timeouts and error handling
  auth.ts                  Sign-in: what the browser sends, and the messages it shows
  server/                  OpenAI client, system prompts, validation, rate limit
  server/auth/             Sign-in on the server: settings, sessions, email codes, Google
examples/                  The worked example
tests/                     Unit tests
```

## Known limits

- **Older browsers record live.** Browsers without the WebCodecs feature cannot build the
  file frame by frame (see "How the video file is made"), so they record the player as it
  plays. That takes as long as the video, needs the tab open and in front, and may save WebM
  instead of MP4. Some apps, for example WhatsApp, will not play WebM.
- **No sound in explainer videos** yet. Cartoon stories have voices; neither has music.
- **Nothing is saved.** There is no database, so reloading the page clears your work, even
  when [sign-in](#sign-in) is switched on.
  Download the storyboard `.json` to keep a copy.
- **Languages**: any language OpenAI can write works. Indian scripts use the app's own fonts;
  other scripts fall back to your device's fonts. Right-to-left layout (Urdu, Arabic) is not
  tuned yet. The health disclaimer is shown in the video's language and in English.

## Next steps

- **Voiceover for explainer videos**: reuse the cartoon voices to narrate each scene and time
  the scene to its audio.
- **Background music**: a small library of licensed tracks mixed into the recording.
- **Server-side MP4 rendering**: render frames on the server (for example with Remotion or
  headless Chrome plus FFmpeg) so that even browsers without WebCodecs get the same file.
- **A third-party video model**: an optional step that turns a scene into a generated clip,
  behind the same storyboard format.
- **One-tap posting to Instagram** (YouTube is done): needs an Instagram professional
  account with a Meta developer app and access token, and somewhere to host the video briefly
  (Meta fetches it from a public link).
- Also worth doing: saving and reopening projects, importing a storyboard `.json`, captions
  and translation into more languages, your own logo and colours.
