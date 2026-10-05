# Explainer Studio

Describe a short awareness or explainer video in a sentence or two. The app turns it into a
clear five-part prompt, asks OpenAI for a scene-by-scene storyboard, plays it as an animated
video in the browser and lets you download it.

It is built for people who are not technical: parents, teachers, health educators and NGOs.

**How it works**

1. **Describe**: type what the video is about, who it is for and how it should feel.
2. **Prompt**: the app writes a five-part prompt (Act as, Goal, Context, Constraints, Output).
   You can edit every part and see the exact text that will be sent.
3. **Video**: OpenAI writes the storyboard. The app draws it with animated text and simple
   illustrations. Edit, reorder, delete or rewrite scenes, then record and download.

OpenAI is used for text only. The video itself is drawn and recorded in your browser, so no
video-generation service is needed.

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
| `OPENAI_MODERATION_MODEL` | No | Defaults to `omni-moderation-latest`. |
| `RATE_LIMIT_PER_MINUTE` | No | Requests allowed per IP address per minute. Default `10`. |

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app for development |
| `npm run build` then `npm start` | Build and run the production version |
| `npm test` | Run the unit tests |
| `npm run lint` and `npm run typecheck` | Check the code |

## Deploying to Vercel

1. Put the project in a Git repository and push it to GitHub, GitLab or Bitbucket.
   `.env.local` is ignored by Git, so your key stays on your computer.
2. In [Vercel](https://vercel.com/new), choose **Add New → Project** and import the repository.
   Vercel detects Next.js; keep the default build settings.
3. Under **Environment Variables**, add `OPENAI_API_KEY` and `OPENAI_TEXT_MODEL` (and any
   optional settings from the table above).
4. Click **Deploy**.

Good to know:

- **Node version**: `package.json` asks for Node 22 or newer, which Vercel picks up.
- **Time limit**: each API route allows up to 60 seconds (`maxDuration`). If long storyboards
  time out, set `OPENAI_REASONING_EFFORT=low` or use a faster model.
- **Changing settings**: after editing environment variables in Vercel, redeploy.
- **Rate limiting**: the built-in limiter keeps its counters in memory. On Vercel each server
  instance counts separately, so treat it as a speed bump. For a strict limit, add Vercel's
  firewall rate limiting or swap `lib/server/rateLimit.ts` for a shared store such as Redis.
- **Spending**: set a monthly budget in your OpenAI account so a busy day cannot surprise you.

## Keeping the API key safe

- `OPENAI_API_KEY` is read only on the server (`lib/server/handler.ts`). It is never sent to
  the browser and never written to logs. The home page only learns *whether* a key exists.
- Every OpenAI call goes through the three server routes in `app/api/`.
- **Use my own key** (the "API key" button): the key is kept in the page's memory only. It is
  not saved to localStorage, cookies or the URL. It is sent over HTTPS in a request header,
  used for that one request and then discarded. The server refuses it over plain HTTP (except
  on `localhost`).
- Error messages from OpenAI are never passed through to users or logs, because they can
  repeat part of a key.

## Safety and quality

- **Moderation**: everything people type goes through OpenAI's moderation endpoint before any
  text is generated, including the edited prompt and rewrite notes.
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

These two files were written by hand to show the exact format the app uses. They are not a
saved OpenAI response, and a real run will word things differently. They also power the
"ready-made example" on the home page.

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
components/
  Studio.tsx               The three-step flow and its state
  DescribeStep.tsx         Text box, example chips, clarifying questions
  PromptStep.tsx           Five editable cards, live preview, Copy
  VideoStep.tsx            Player, scene editor, recording
  Player.tsx               Canvas player and controls
  SceneList.tsx            Edit, reorder, delete, rewrite scenes
  ExportPanel.tsx          Video, .json and .txt downloads
  ApiKeyPanel.tsx          "Use my own key"
lib/
  schemas.ts               Zod schemas for prompts, storyboards and the API
  prompt.ts                The five parts and how they are assembled
  visuals.ts, visualArt.ts The illustration library (IDs and SVG artwork)
  renderer.ts              Draws any moment of a storyboard on a canvas
  recorder.ts              MediaRecorder: MP4 where supported, otherwise WebM
  api.ts                   Browser-side fetch with timeouts and error handling
  server/                  OpenAI client, system prompts, validation, rate limit
examples/                  The worked example
tests/                     Unit tests
```

## Known limits

- **Recording happens in real time.** A 2-minute video takes 2 minutes to record, and the tab
  must stay open and visible while it does.
- **Format depends on the browser.** The app saves MP4 when the browser can record it (tested
  in Chrome) and WebM when it cannot. Some apps, for example WhatsApp, will not play WebM; if
  you get a WebM file, record in Chrome instead or convert it.
- **No sound** yet: there is no voiceover or music.
- **Nothing is saved.** There is no database or login, so reloading the page clears your work.
  Download the storyboard `.json` to keep a copy.
- **Languages**: any language OpenAI can write works, and text falls back to your device's
  fonts for scripts the built-in fonts do not cover. Right-to-left layout is not tuned yet.

## Next steps

- **Voiceover**: add a narration line per scene and generate speech with a text-to-speech API,
  then time each scene to its audio.
- **Background music**: a small library of licensed tracks mixed into the recording.
- **Server-side MP4 rendering**: render frames on the server (for example with Remotion or
  headless Chrome plus FFmpeg) for faster exports and the same file in every browser.
- **A third-party video model**: an optional step that turns a scene into a generated clip,
  behind the same storyboard format.
- Also worth doing: saving and reopening projects, importing a storyboard `.json`, captions
  and translation into more languages, your own logo and colours.
