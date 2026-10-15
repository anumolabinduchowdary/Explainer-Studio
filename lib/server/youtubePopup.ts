import "server-only";

const MESSAGES = {
  connected: "YouTube is connected. You can close this window.",
  failed: "YouTube was not connected.",
} as const;

/**
 * The small page shown in the connection window. It tells the app's main
 * page what happened and closes itself. Only fixed messages are shown, never
 * anything taken from the address.
 */
export function popupPage(result: keyof typeof MESSAGES, detail = "", cookies: string[] = []): Response {
  const escape = (text: string) =>
    text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
  const message = JSON.stringify({ source: "explainer-studio", youtube: result, detail }).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>YouTube</title>
<style>body{font-family:system-ui,sans-serif;background:#fffaf3;color:#2b2118;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}p{max-width:28rem;font-size:18px;line-height:1.5}</style></head>
<body><main><p><strong>${escape(MESSAGES[result])}</strong></p>${detail ? `<p>${escape(detail)}</p>` : ""}<p><a href="/">Back to the app</a></p></main>
<script>try{if(window.opener){window.opener.postMessage(${message},location.origin);setTimeout(function(){window.close()},${result === "connected" ? 400 : 4000})}}catch(e){}</script>
</body></html>`;
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(html, { status: 200, headers });
}
