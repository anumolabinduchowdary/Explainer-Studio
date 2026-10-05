# Explainer Studio

Describe a short awareness or explainer video in a sentence or two. The app turns it into a
clear five-part prompt, asks OpenAI to write it, plays it as an animated video in the browser
and lets you download it.

It is built for people who are not technical: parents, teachers, health educators and NGOs.

There are two sections:

- **Explainer videos**: animated text with simple built-in illustrations.
- **Cartoon stories**: talking characters and backgrounds drawn by AI, with AI voices and
  word-by-word captions. See [Cartoon stories](#cartoon-stories).

**How it works**

1. **Describe**: type what the video is about, who it is for and how it should feel, or press
   **Speak instead of typing** and say it in any language.
2. **Prompt**: the app writes a five-part prompt (Act as, Goal, Context, Constraints, Output).
   You can edit every part and see the exact text that will be sent.
3. **Video**: OpenAI writes the storyboard. The app draws it with animated text and simple
   illustrations. Edit, reorder, delete or rewrite scenes, then record and download.

Explainer videos use OpenAI for text only. Cartoon stories also use OpenAI's image model to
draw the pictures and its speech model for the voices. In both, the video itself is animated
and recorded in your browser, so no video-generation service is needed.

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
| `OPENAI_SPEECH_MODEL` | For voices | The text-to-speech model, for example `gpt-4o-mini-tts`. |
| `OPENAI_TRANSCRIBE_MODEL` | For speaking | The speech-to-text model behind "Speak instead of typing", for example `gpt-transcribe`. |
| `OPENAI_MODERATION_MODEL` | No | Defaults to `omni-moderation-latest`. |
| `RATE_LIMIT_PER_MINUTE` | No | Text requests allowed per IP address per minute. Default `10`. |
| `RATE_LIMIT_IMAGES_PER_MINUTE` | No | Pictures allowed per IP address per minute. Default `12`. |
| `RATE_LIMIT_SPEECH_PER_MINUTE` | No | Spoken lines allowed per IP address per minute. Default `60`. |

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app for development |
| `npm run build` then `npm start` | Build and run the production version |
| `npm test` | Run the unit tests |
| `npm run lint` and `npm run typecheck` | Check the code |

## Cartoon stories

A cartoon story is a short conversation between up to four characters, in up to four places.

1. **Describe** and **Prompt** work as for explainer videos.
2. OpenAI writes the story: the characters and places (each with a description of what to
   draw), the scenes, and who says what.
3. Click **Draw the pictures**. For each character the image model draws a cut-out with a
   transparent background, then a second version with the mouth open. For each place it draws
   a background. The app places the characters in the background, makes the speaker bounce
   and move their mouth, and shows the words as large captions.
4. Click **Record the voices**. Each line is spoken by an AI voice. The story gives every
   character a voice and a manner of speaking ("a cheerful six-year-old boy"); change either
   and press **Listen** to compare. The speaker's mouth then follows the loudness of the
   voice, the captions follow its timing, and the sound is included in the downloaded video.
5. Edit names, descriptions, lines and who is on screen; redraw any picture; then record.

Things to know:

- **Cost**: each character needs 2 pictures and each background 1, so a typical story with
  3 characters and 3 places is 9 pictures. Nothing is drawn until you click the button. See
  [OpenAI's pricing](https://openai.com/api/pricing/) for the cost per picture.
- **Check every picture.** AI drawings can get details wrong, for example hands or the shape
  of a wheelchair or walker. Edit the description and redraw until it is right.
- **Characters can drift.** Each picture is drawn separately from the same description, so the
  mouth-open version can differ slightly from the first. If it looks wrong, untick
  "Mouth moves when talking" for that character; they will bounce while speaking instead.
- **Pictures are not saved.** They live in the page's memory, like everything else. Reloading
  the page clears them, and they would need to be drawn (and paid for) again.
- **Say that the voices are AI.** OpenAI requires a clear statement to listeners that the
  voices are AI-generated and not real people. Put it in the caption or description wherever
  you share the video.
- **Voices cost per line.** One request per spoken line, so about 15 for the example story.
  Editing a line, or changing a character's voice, means recording that line again.
- **There are no child voices.** A child character is an adult voice asked to sound young.
  Listen before you publish, and change the voice or the description if it does not fit.
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
- Every OpenAI call goes through the three server routes in `app/api/`.
- **Use my own key** (the "API key" button): the key is kept in the page's memory only. It is
  not saved to localStorage, cookies or the URL. It is sent over HTTPS in a request header,
  used for that one request and then discarded. The server refuses it over plain HTTP (except
  on `localhost`).
- Error messages from OpenAI are never passed through to users or logs, because they can
  repeat part of a key.

## Speaking instead of typing

Both Describe screens have a **Speak instead of typing** button. It records up to a minute
from the microphone, sends the recording to OpenAI to be written down, and adds the words to
the text box, where they can be corrected before building the prompt.

- The browser asks for permission to use the microphone the first time. Microphones only work
  on `https://` sites and on `localhost`.
- The recording is passed to OpenAI and is not stored by this app.
- The language is detected automatically.
- The button does not appear in browsers that cannot record sound.

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
- [`examples/cerebral-palsy.story.json`](examples/cerebral-palsy.story.json): a cartoon story on the same topic, with 3 characters, 3 places and 5 scenes

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
  api/story/route.ts       Five-part prompt -> cartoon story script
  api/image/route.ts       Draw one picture (character, talking pose or background)
  api/speech/route.ts      Speak one line in a character's voice
  api/transcribe/route.ts  Write down a spoken description
components/
  AppShell.tsx             Header, the two section tabs, API key panel
  Studio.tsx               The three-step flow and its state, for one section
  DescribeStep.tsx         Text box, example chips, clarifying questions
  SpeakButton.tsx          Microphone button: record, send, add the words to the text box
  PromptStep.tsx           Five editable cards, live preview, Copy
  VideoStep.tsx            Explainer step 3: player, scene editor, recording
  StoryStep.tsx            Cartoon step 3: draws pictures, player, recording
  StoryPictures.tsx        Characters and backgrounds: describe, draw, redraw
  StoryVoices.tsx          Voices: choose, listen, record the lines
  StoryScenes.tsx          Cartoon scenes: who is on screen and what they say
  Player.tsx               Canvas player and controls (shared by both sections)
  SceneList.tsx            Edit, reorder, delete, rewrite scenes
  ExportPanel.tsx          Video, .json and .txt downloads
  ApiKeyPanel.tsx          "Use my own key"
lib/
  schemas.ts               Zod schemas for prompts, storyboards and the API
  prompt.ts                The five parts and how they are assembled
  visuals.ts, visualArt.ts The illustration library (IDs and SVG artwork)
  renderer.ts              Draws any moment of a storyboard on a canvas
  story.ts                 Cartoon story format, timing and caption rules
  storyRenderer.ts         Draws any moment of a cartoon story on a canvas
  storyPictures.ts         Requests pictures and voices and prepares pictures for drawing
  storyAudio.ts            Plays voice clips in step with the picture and feeds the recording
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
  headless Chrome plus FFmpeg) for faster exports and the same file in every browser.
- **A third-party video model**: an optional step that turns a scene into a generated clip,
  behind the same storyboard format.
- Also worth doing: saving and reopening projects, importing a storyboard `.json`, captions
  and translation into more languages, your own logo and colours.
