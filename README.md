# Task Tracker+ (Root App)

A project and task tracker for [Root](https://www.rootapp.com) communities.

**[Privacy Policy](PRIVACY.md)** · **[Terms of Use](TERMS.md)**

Task Tracker+ is an independent app. It is not made by, affiliated with or endorsed by Root Communications, Inc.

## What it does

It works like Root's free **Task Tracker** app, with two additions:

1. **Attach any file** — to a task (Attachments section, or while creating it) and to comments.
2. **Download anything posted** — every image, song/audio clip, video and file has a Download button; images open in a viewer with Download, audio plays inline, video plays in the viewer.

Everything else mirrors Root's Task Tracker and nothing extra was added:

| Area | Behaviour |
| --- | --- |
| Projects | Name (100), description (5,000), 1–4 char identifier auto-generated from the name, optional image, progress bar by phase, favourites (sorted first), search, archive / unarchive (read-only while archived), delete |
| Access | Per project: **View only**, **Contribute tasks** (default: everyone), **Manage all tasks** (default: creator). Members in none of them can't see the project |
| Global roles | App settings → **Task Tracker Admins** and **Task Tracker Project Creators** (the community owner is always an admin) |
| Tasks | `ID-123` keys, phases Backlog → Planned (default) → In Progress → In Review → Done / Cancelled, priority High / Mid (default) / Low, assignee (member or role), up to 20 tags, due date, rich-text description (10,000) |
| Board | Phase groups stacked top to bottom, drag & drop between phases (mouse and touch), inline priority / status changes, search, tag filter |
| Detail | Inline editing with auto-save, comments (2,000 chars, 50 per task, edit/delete your own) and an automatic history of status, priority, assignee, tag, due-date and attachment changes |
| Dashboard | Greeting, tasks assigned to you, projects; separate **My tasks** view (overdue and due-soon first) |
| Tags | Community-wide coloured tags (default lime green) managed from the Tags page |
| Notifications | Assigned / taken off a task, comments on tasks you created or are assigned to, phase moves — each deep-links to the task |
| Live updates | Changes appear instantly for everyone who can see the project |

Contributors can edit, delete and attach files to their own tasks; managers can do so on any task. Anyone who can view a project can download its files.

## Project layout

```
networking/src/tracker.proto   client ⇄ server contract (RPCs + live events)
server/src/                    Node server: SQLite store, access rules, assets, notifications
client/src/                    React UI (Root design tokens, light & dark)
root-manifest.json             app id, version, packaging, the two global settings
```

## Run it locally (Root devhost)

Requires Node 22+ on Windows or macOS and a Root account.

**On Windows, just double-click `test.cmd`.** The first time it asks for your dev token (step 1 below) and saves it to `server/.env`. Then it installs, builds, and opens the server and client in two windows. To use a new dev token, delete `server/.env` and run it again.

By hand:

1. The app is registered in the [Root Developer Portal](https://dev.rootapp.com) as **Task Tracker+**, and its App ID is already in `root-manifest.json`. On the app's **Overview** page, click **Generate new dev token** and save it as `server/.env` (see `server/.env.example`).
2. Install and build:
   ```sh
   npm install
   npm run build
   ```
3. Two terminals from the project root:
   ```sh
   cd server && npm run server     # devhost — connects to the app's test community
   cd client && npm run client     # Vite — opens the client
   ```

In the browser devhost, downloads use a normal browser download; inside the Root desktop and mobile apps they go through Root's own download flow.

## Publish

```sh
npm install && npm run build
npx rootsdk build package --output-file ./rootapp.pkg --project-folder .
npx rootsdk upload package --file ./rootapp.pkg --authToken <AUTH_TOKEN> --host dev.rootapp.com
```

`<AUTH_TOKEN>` comes from the Dev Portal under **Settings → Tokens → Generate new auth token**. Bump `"version"` in `root-manifest.json` for every upload; Root rejects a version that isn't higher than the last one.

Root's upload tool runs on Windows and Linux (x64) only.

## Notes

- Files are stored by Root (`dataStore.assets`); the app keeps permanent asset references in its SQLite database, which Root backs up.
- Root currently allows about 100 uploads / 250 MB per hour per app; the app caps 20 files per upload, 100 per task and 10 per comment.
- File names, sizes and types come from Root's asset metadata. If Root returns no name for a file, it gets a generic one such as `file.pdf` or `image.png`.
- Unclaimed draft uploads (a comment or new task you abandoned) are cleaned up after 24 hours.
