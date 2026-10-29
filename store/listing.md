# Chrome Web Store listing

Paste-ready text for the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). Images are in this folder (`npm run store-assets` re-renders them) and in `docs/`.

## Package

`npm run package` → upload `github-image-viewer.zip`. Bump `version` in `extension/manifest.json` for every update.

## Store listing tab

**Name** (from the manifest): Image Viewer for GitHub

**Summary** (from the manifest): Open images in GitHub issues, PRs, comments and READMEs in an in-page viewer with arrows, zoom, rotate, copy and download.

**Category:** Developer Tools

**Language:** English

**Description:**

```
Click a screenshot in a GitHub pull request and it opens right there, on top of the page, instead of in a new tab. Reviewing a PR with twenty screenshots no longer means twenty tabs.

FEATURES
• Browse every image in the pull request, issue or README in page order, with a thumbnail strip, arrow keys, or swipe.
• Click to zoom into the spot you clicked; scroll or pinch to zoom, drag to pan. Text in screenshots stays sharp.
• Captions come from the table heading above a screenshot (the usual "Before | After" layout), a label, or alt text. The comment author and the image size are shown too.
• Copy an image to the clipboard, copy its link, or download it with the right file extension. "Download all" saves every image on the page into one folder, named after their captions.
• Rotate, fullscreen, and keyboard shortcuts for everything (press ? in the viewer). ⌘ shortcuts on macOS, Ctrl on Windows and Linux.
• ⌘/Ctrl-click still opens an image in a new tab, and badges, emoji and links to other sites keep working as before.

PRIVACY
Everything happens in your browser. When you open the viewer, the extension reads the images, their captions and the comment author from that page to show them. Images are loaded from where they are hosted (normally GitHub's own image servers), the same way the page loads them. The developer receives no data: there is no server, no analytics and no tracking, and the extension stores nothing except that you agreed to its one-time notice. The first time you click an image, the viewer explains what it reads and asks you to agree before it reads anything. Copied and downloaded images go only to your clipboard and Downloads folder, when you choose. Privacy policy: https://github.com/AyushKaithwas/github-image-viewer/blob/main/PRIVACY.md

Open source: https://github.com/AyushKaithwas/github-image-viewer

Image Viewer for GitHub is an independent project, not affiliated with or endorsed by GitHub, Inc.
```

**Graphic assets:**

| Field | File |
| --- | --- |
| Store icon (128×128) | `extension/icons/icon128.png` |
| Screenshots (1280×800) | `docs/viewer.png`, `docs/zoom.png`, `docs/shortcuts.png` |
| Small promo tile (440×280) | `store/promo-small.png` |
| Marquee promo tile (1400×560) | `store/promo-marquee.png` |

**Homepage URL:** https://github.com/AyushKaithwas/github-image-viewer

**Support URL:** https://github.com/AyushKaithwas/github-image-viewer/issues

## Privacy tab

**Single purpose:**

```
Opens images in GitHub pull requests, issues, comments, READMEs and gists in an in-page viewer, with navigation, zoom, rotation, copying and downloading of those images, instead of opening each image in a new tab.
```

**Permission justification: downloads**

```
Used only when the user clicks Download or Download all in the viewer. Saves the chosen images through Chrome's download manager with a readable filename and the correct image extension, and puts "Download all" images in one folder named after the page. The extension does not read or search the user's download history.
```

**Permission justification: storage**

```
Stores a single value: that the user agreed to the one-time notice the viewer shows on first use (what it reads from the page, and that none of it is sent to the developer). This means the notice isn't shown on every click. No page content or other data is stored.
```

**Host permission justification**

```
github.com: runs the image viewer on GitHub pages (pull requests, issues, comments, READMEs), and fetches GitHub-hosted images (attachments and repository images) when the user clicks Copy image.

raw, camo, private-user-images, user-images, media and gist .githubusercontent.com: GitHub's image servers. When the user clicks Copy image, the background worker fetches the image's bytes from these hosts so it can be converted to PNG and put on the clipboard. Web pages can't read these images directly because of cross-origin restrictions. The worker only requests addresses on these hosts and only accepts image responses from them (a github.com /raw/ link redirects to raw.githubusercontent.com). Fetched data is only ever treated as an image and is never executed.
```

**Are you using remote code?** No, I am not using remote code.

**Data usage: what user data do you collect?** Tick **Personally identifiable information** and **Website content**.

- Personally identifiable information: the GitHub username of a comment's author is read from the page and shown next to the image. Google's user data FAQ counts usernames as PII.
- Website content: the images, their addresses and nearby caption text on the page the viewer is opened on.

Both are processed only in the browser, only to show the viewer, and are never sent to the developer. Leave the other categories unticked. The extension doesn't read credentials (the browser attaches GitHub's cookies to image requests itself), and doesn't read or keep a list of visited pages (the current page address is used only locally, to name a download folder).

**Certify all three:**

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/AyushKaithwas/github-image-viewer/blob/main/PRIVACY.md

## Distribution tab

Free, public, all regions.

## Test instructions (for the reviewer)

```
No account or setup is needed.
1. Open https://github.com/microsoft/vscode/issues/344285 (a public issue with several screenshots).
2. Click any screenshot in the issue. It opens in the in-page viewer instead of a new tab.
3. Use the arrow keys or the thumbnails to move between images. Click the image to zoom in, and click again to fit.
4. Press C to copy the image (paste it anywhere), or D to download it. Shift+D downloads all images into one folder.
5. Press ? to see all shortcuts, and Esc to close.
```

## Before submitting

- Turn on 2-Step Verification on the Google account (required to publish).
- Push to GitHub first, so the privacy policy URL works.
- Open the privacy policy URL in a signed-out window to check it loads.
