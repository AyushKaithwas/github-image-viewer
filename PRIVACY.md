# Privacy policy

*Last updated: 30 October 2026*

Image Viewer for GitHub is a browser extension that opens images on GitHub pages in an in-page viewer. This policy explains what data it handles, how, and who receives it.

**In short:** the extension processes page content in your browser to show the viewer. The developer receives none of it, and there is no server, analytics or tracking. The only network requests are for the images themselves.

## Data the extension handles

When you click an image in rendered content on `github.com` or `gist.github.com` (pull requests, issues, comments, READMEs, gists), the extension reads from that page:

- **Website content:** the images in that content, their addresses (URLs), and nearby text it shows as captions (table headings, labels, alt text).
- **Usernames:** the GitHub username of the comment's author, shown next to the image.
- **The page address:** used to name the folder when you choose *Download all* (for example `octo-org octo-app pull 42`).

It only does this when you open the viewer, and only after you have agreed to a short notice explaining this, shown the first time you click an image. It does not read pages you haven't opened it on, and does not look at your browsing history.

## How it is used

All processing happens in your browser:

- **Viewing:** images are loaded from where GitHub hosts them, as the page itself does.
- **Copy image / Copy link:** only when you choose it, the image or its address is placed on your clipboard.
- **Download / Download all:** only when you choose it, the images are saved through Chrome's download manager to your Downloads folder.

The gallery information is held in memory while the viewer is open and discarded when it closes. The only thing the extension stores is the fact that you agreed to that first-use notice (in Chrome's extension storage, on your device), so it isn't shown again. It does not use local storage or its own cookies, and stores no page content. What you copy or download stays on your clipboard or disk under your control, and Chrome's normal download history and cache apply.

## Who receives data

- **The developer: nothing.** The extension has no server and sends no data to the developer.
- **No third parties:** no analytics, advertising, or tracking services. No data is sold, and nothing is transferred to anyone apart from the image requests described next.
- **GitHub (and the image's host):** to show, copy, or download an image, your browser requests it from where it is hosted, normally GitHub's own image servers. As with any request, that host receives standard request information such as your IP address and the image address. Requests to GitHub include your existing GitHub session cookies, which the browser attaches, so images in private repositories you already have access to work. The extension never reads or stores those cookies or any password.

## Limited Use

The use of information received by this extension adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the Limited Use requirements. User data is used only to provide the image viewer. It is not transferred to third parties (other than the image requests to an image's host described above, which the viewer needs to work), is never used for advertising, and is never used to determine creditworthiness or for lending. No human reads it.

## Permissions

| Permission | Why |
| --- | --- |
| `downloads` | Save the images you choose to download, with readable filenames and folders |
| `storage` | Remember that you agreed to the first-use notice |
| `github.com` | Run the viewer on GitHub pages, and fetch GitHub-hosted images when you copy one |
| `raw`, `camo`, `private-user-images`, `user-images`, `media`, `gist` `.githubusercontent.com` | Fetch the image file from GitHub's image servers when you press Copy (they don't let web pages read images across sites) |

The viewer also runs on `gist.github.com` pages.

## Changes

If this policy changes, the new version will be published at this address with a new date.

## Contact

Questions or concerns: open an issue at <https://github.com/AyushKaithwas/github-image-viewer/issues>.

Image Viewer for GitHub is an independent project and is not affiliated with or endorsed by GitHub, Inc.
