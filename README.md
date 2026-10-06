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
| `SPEECHGEN_API_TOKEN` | No | Your [SpeechGen](https://speechgen.io) API token. Set it together with `SPEECHGEN_EMAIL` to use SpeechGen's voices instead of OpenAI's. Server-side only. See [SpeechGen voices](#speechgen-voices). |
| `SPEECHGEN_EMAIL` | With the token | The email address of the SpeechGen account. |
| `SPEECHGEN_ACCENT` | No | The accent to prefer when a language has several: `Indian` (the default), `US`, `British`… |
| `OPENAI_TRANSCRIBE_MODEL` | For speaking | The speech-to-text model behind "Speak instead of typing", for example `gpt-transcribe`. |
| `OPENAI_MODERATION_MODEL` | No | Defaults to `omni-moderation-latest`. |
| `RATE_LIMIT_PER_MINUTE` | No | Text requests allowed per IP address per minute. Default `10`. |
| `RATE_LIMIT_IMAGES_PER_MINUTE` | No | Pictures allowed per IP address per minute. Default `24`. |
| `RATE_LIMIT_SPEECH_PER_MINUTE` | No | Spoken lines allowed per IP address per minute. Default `60`. |

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
stands in two rows, taller people at the back.

1. **Describe** who is in the story, where it happens and what it should teach, for example
   "4 children in a physiotherapy centre with their physiotherapist".
2. **Plan**: the app turns that into a story plan and shows it for checking:
   - **Characters**: one entry for every person you described (here, four children and one
     adult), each with a name, who they are, an age and what they look like.
   - **Places**: where it happens (here, the physiotherapy centre).
   - **Message**: what the video should teach.
   - **Details**: length, shape, language, tone and anything to include or avoid.

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
  is drawn a second time with a hand raised, and switches to that pose now and then while
  speaking. Untick it for the whole story, or per character, if a gesture drawing looks wrong.
- **Cost**: each character needs 4 pictures with gestures (2 without) and each background 1,
  so a story with 3 characters and 3 places is 15 pictures (9 without gestures), and one with
  5 characters and 1 place is 21. The plan shows this number before anything is written.
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
- **Children and older people.** With [SpeechGen voices](#speechgen-voices) switched on,
  English stories use real children's and older voices. OpenAI's 13 voices are all adults. The **Age** setting
  (Child, Teenager, Adult, Older person) gets closer in two ways at once: the voice is asked
  to act that age, and the recording is played back faster or slower, which raises or lowers
  its pitch (a child about 20% higher, a teenager 8% higher, an older person 7% lower). The
  result is a cartoon-style child or elder, not a real one. Listen before you publish, and
  try another voice if it does not fit. The amounts are set in `VOICE_AGE_SETTINGS` in
  `lib/story.ts`.
- **Languages.** The voices speak the language the lines are written in, but they are tuned
  for English. Check the pronunciation in other languages before sharing.
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

## Keeping the API key safe

- `OPENAI_API_KEY` is read only on the server (`lib/server/handler.ts`). It is never sent to
  the browser and never written to logs. The home page only learns *whether* a key exists.
- Every OpenAI call goes through the server routes in `app/api/`.
- The SpeechGen token (`SPEECHGEN_API_TOKEN`), if you use one, is handled the same way: read
  on the server only, sent to SpeechGen in the body of a POST request, and never logged, put
  in a web address or sent to the browser. Visitors cannot supply their own.
- **Use my own key** (the "API key" button): the key is kept in the page's memory only. It is
  not saved to localStorage, cookies or the URL. It is sent over HTTPS in a request header,
  used for that one request and then discarded. The server refuses it over plain HTTP (except
  on `localhost`).
- Error messages from OpenAI and SpeechGen are never passed through to users or logs,
  because they can repeat part of a key.

## Sharing to Instagram, YouTube and other apps

When a video has been recorded, the Download panel shows a **Share** section:

- A suggested caption (the title, the health disclaimer and AI-voice statement where they
  apply, and the account to follow). Edit it, or press **Copy caption**.
- On a phone, **Share to Instagram, YouTube…** opens the phone's own share menu with the
  video attached. Choose the app, paste the caption and post. The caption is copied
  automatically because most apps ignore text sent along with a video.
- On a computer the share menu rarely lists those apps, so download the video and upload it.

This uses the browser's built-in sharing, so the app never holds anyone's Instagram or
YouTube login. Posting with no taps at all would need Meta's and Google's publishing
programmes: see "Next steps".

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

Every video, in both sections, ends with a 4-second closing card showing the Special
Parenting Instagram QR code. It is on by default; untick **End with our Instagram QR code**
on the video screen to leave it off for one video.

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
- A character marked as a child gets a real child's voice when the language has one, and a
  grandfather gets an older man's voice. Today only English (US, British, Australian) has
  children's voices, so **children in an English story speak with an American or British
  accent** while the adults keep the Indian one. If you prefer one accent throughout, pick an
  Indian voice for the child in the Voices panel and leave the age on Child: the pitch is
  then raised, as it is with OpenAI's voices.
- Languages without children's voices (Hindi, Telugu, Tamil…) always use that method.
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

## Safety and quality

- **Moderation**: everything people type goes through OpenAI's moderation endpoint before any
  text is generated, including the edited prompt, the edited story plan and rewrite notes.
- **Validation**: every model answer is requested with Structured Outputs and then checked
  with Zod. If it fails, the app retries once and then shows a friendly error.
- **Respectful language**: the storyboard instructions ask for accurate, respectful, inclusive
  and non-sensational wording (`lib/server/systemPrompts.ts`).
- **Health videos**: the server makes sure the last scene ends with
  "For awareness, not medical advice." even if the model forgets.
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
  page.tsx                 Home page (checks whether a server key exists)
  layout.tsx, globals.css  Fonts, colours and base styles
  api/prompt/route.ts      Description -> five-part prompt, or up to 3 questions
  api/storyboard/route.ts  Five-part prompt -> storyboard
  api/scene/route.ts       Rewrite one scene
  api/plan/route.ts        Description -> story plan (characters, places, message, details)
  api/story/route.ts       Story plan -> cartoon story script
  api/image/route.ts       Draw one picture (character, talking pose or background)
  api/speech/route.ts      Speak one line in a character's voice (OpenAI or SpeechGen)
  api/voices/route.ts      The voices that can be chosen for a story's language
  api/transcribe/route.ts  Write down a spoken description
components/
  AppShell.tsx             Header, the two section tabs, API key panel
  Studio.tsx               The three-step flow and its state, for one section
  DescribeStep.tsx         Text box, example chips, clarifying questions
  SpeakButton.tsx          Microphone button: record, send, add the words to the text box
  PromptStep.tsx           Explainer step 2: five editable cards, live preview, Copy
  PlanStep.tsx             Cartoon step 2: the characters, places, message and details
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
lib/
  schemas.ts               Zod schemas for prompts, storyboards and the API
  prompt.ts                The five parts and how they are assembled
  plan.ts                  The story plan: its format, limits and plain-text version
  visuals.ts, visualArt.ts The illustration library (IDs and SVG artwork)
  renderer.ts              Draws any moment of a storyboard on a canvas
  story.ts                 Cartoon story format, timing and caption rules
  storyRenderer.ts         Draws any moment of a cartoon story on a canvas
  voices.ts                Voice lists, and giving each character a voice of the right gender and age
  storyPictures.ts         Requests pictures and voices and prepares pictures for drawing
  storyAudio.ts            Plays voice clips in step with the picture and feeds the recording
  endCard.ts               The closing QR card added to the end of every video
  exportVideo.ts           Builds the MP4 frame by frame (WebCodecs + Mediabunny)
  recorder.ts              Fallback for older browsers: records the player live
  api.ts                   Browser-side fetch with timeouts and error handling
  server/                  OpenAI client, system prompts, validation, rate limit
examples/                  The worked example
tests/                     Unit tests
```

## Known limits

- **Older browsers record live.** Browsers without the WebCodecs feature cannot build the
  file frame by frame (see "How the video file is made"), so they record the player as it
  plays. That takes as long as the video, needs the tab open and in front, and may save WebM
  instead of MP4. Some apps, for example WhatsApp, will not play WebM.
- **No sound in explainer videos** yet. Cartoon stories have voices; neither has music.
- **Nothing is saved.** There is no database or login, so reloading the page clears your work.
  Download the storyboard `.json` to keep a copy.
- **Languages**: any language OpenAI can write works, and text falls back to your device's
  fonts for scripts the built-in fonts do not cover. Right-to-left layout is not tuned yet.

## Next steps

- **Voiceover for explainer videos**: reuse the cartoon voices to narrate each scene and time
  the scene to its audio.
- **Background music**: a small library of licensed tracks mixed into the recording.
- **Server-side MP4 rendering**: render frames on the server (for example with Remotion or
  headless Chrome plus FFmpeg) so that even browsers without WebCodecs get the same file.
- **A third-party video model**: an optional step that turns a scene into a generated clip,
  behind the same storyboard format.
- **One-tap posting to your own Instagram and YouTube**: needs an Instagram professional
  account with a Meta developer app and access token, a Google Cloud project approved for
  YouTube uploads, somewhere to host the video briefly (Meta fetches it from a public link),
  and an owner-only login so visitors cannot post to your accounts.
- Also worth doing: saving and reopening projects, importing a storyboard `.json`, captions
  and translation into more languages, your own logo and colours.
