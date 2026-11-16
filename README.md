# CrossPost

Upload one video and post it to all your linked channels at once:
**YouTube (incl. Shorts), TikTok, Instagram Reels and Facebook Pages.**

It runs on your own computer at http://localhost:3000. Your sign-in tokens stay in `data/accounts.json` on your PC.

## Start it

1. Install [Node.js](https://nodejs.org) 20.16 or newer (you have it already if `node -v` works).
2. Download this project: click **Code → Download ZIP** on GitHub and unzip it, or run
   `git clone https://github.com/haseebhaider4/Video-Poster-on-Different-Platforms.git`
3. Copy `.env.example` to `.env` and fill in the keys for the platforms you want (steps below).
4. Double-click **`start.bat`**, or run:
   ```bash
   npm install
   ```
   ```bash
   npm start
   ```
5. Open http://localhost:3000, click **Connect** for each platform, then drop a video and hit **Post everywhere**.

Restart the app after you change `.env`.

You can connect several accounts per platform (for example several YouTube channels: click **Add another** and pick the other channel in Google's chooser).

---

## Platform setup

Each platform needs a free "developer app" so CrossPost is allowed to post for you. You only do this once.

### YouTube

1. Go to [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. **APIs & Services → Library**, enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email. Under **Test users**, add the Google account(s) that own your channels.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**.
   Authorized redirect URI: `http://localhost:3000/auth/youtube/callback`
5. Put the Client ID and Client secret into `.env` as `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.

> **Important:** Google keeps videos uploaded by *unverified* API projects **private**, whatever visibility you choose. To post public videos, submit the project for the free [YouTube API audit](https://support.google.com/youtube/contact/yt_api_form). Until it's approved, uploads land as private and you can make them public by hand in YouTube Studio.
> The default quota allows about 6 uploads per day (each upload costs 1,600 of the 10,000 daily units). You can request more in the same audit form.

### TikTok

TikTok only accepts **https** sign-in addresses, so you need a tunnel that gives your PC a public https address:

- **ngrok** (easiest): sign up at [ngrok.com](https://ngrok.com), claim your free *static domain*, then run
  `ngrok http 3000 --url=https://YOUR-NAME.ngrok-free.app`
- or a named **Cloudflare Tunnel** with your own domain.

Set `PUBLIC_URL=https://YOUR-NAME.ngrok-free.app` in `.env`. Keep the tunnel running while you connect TikTok and while you post.
(Only the TikTok sign-in return page and temporary video links are reachable through the tunnel; the dashboard itself is blocked from the internet.)

1. Go to [TikTok for Developers](https://developers.tiktok.com/), create an app.
2. Add the products **Login Kit** and **Content Posting API** (turn on *Direct Post*).
3. Scopes: `user.info.basic` and `video.publish`.
4. Redirect URI: `https://YOUR-NAME.ngrok-free.app/auth/tiktok/callback`
5. Put the Client key and Client secret into `.env` as `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
6. While testing, use the app's **Sandbox** and add your TikTok account as a target user.

> **Important:** Until TikTok audits your app, every post is forced to **Only me** (private). CrossPost picks that automatically and tells you. Apply for the audit in the developer portal to post publicly.

### Instagram Reels + Facebook Pages

Both use one Facebook login.

Requirements: a **Facebook Page** you manage, and for Instagram an **Instagram Business or Creator account linked to that Page** (Instagram app → Settings → Account type; then link it in the Page's settings).

1. Go to [Meta for Developers](https://developers.facebook.com/apps), **Create app**. Pick the use case for managing Pages / Instagram content (or *Other → Business*).
2. Add **Facebook Login for Business** (or Facebook Login) and **Instagram Graph API / Instagram API with Facebook Login**.
3. In Facebook Login settings, Valid OAuth Redirect URI: `http://localhost:3000/auth/meta/callback`
   (Meta allows `localhost` automatically while the app is in **Development** mode, which is all you need for your own accounts.)
4. **App settings → Basic**: copy App ID and App secret into `.env` as `META_APP_ID` and `META_APP_SECRET`.
5. In CrossPost click **Connect** under Facebook or Instagram. When Facebook asks, tick **all** the Pages and Instagram accounts you want. Each Page and each linked Instagram account shows up as its own target.

> Instagram Reels must be 3 s – 15 min, MP4/MOV, and ideally vertical 9:16. Facebook uploads here are limited to 1 GB.

---

## Tips

- Vertical videos under 3 minutes are auto-detected and posted as YouTube Shorts (you can untick it).
- The **description** becomes the YouTube description and the caption elsewhere; the **title** is also added to TikTok/Instagram captions. **Hashtags** are added everywhere (and as YouTube tags).
- If one platform fails, the others still post. The error is shown next to that account and in **Recent posts**, and the full detail is printed in the terminal.
- To remove an account, click **Disconnect**. To wipe everything, delete the `data` folder.

## Files

| Path | What it is |
| --- | --- |
| `server.js` | Web server, sign-in, upload and posting jobs |
| `src/platforms/youtube.js` | YouTube upload (resumable) |
| `src/platforms/tiktok.js` | TikTok Direct Post (chunked) |
| `src/platforms/meta.js` | Facebook Page videos and Instagram Reels |
| `public/` | The dashboard |
| `data/` | Your connected accounts and post history (created on first run, keep private) |

## License

MIT. See [LICENSE](LICENSE).
