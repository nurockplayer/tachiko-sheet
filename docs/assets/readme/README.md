# README and social preview images

| File | What it is | Where it comes from |
| --- | --- | --- |
| `backdrop.png` | Abstract background, no text or interface | Generated with ChatGPT image generation on 2026-11-07 JST; prompt in `backdrop-prompt.txt` |
| `budget-formula.png` | Real app: Budget template, cell D3 selected | Screenshot of the Web build at `588f61c`, 2026-11-07 JST |
| `home.png` | Real app: home screen | Same |
| `report.png` | Real app: sales example, Report tab | Same |
| `hero.png` | README banner, 2560x1280 | `compose.html` rendered at 2x |
| `social-preview.png` | GitHub Social preview, 1280x640 | `hero.png` scaled down |

Product images are real screenshots. Only the background is generated, so the images never show interface the app doesn't have.

To change the words on the banner, edit `compose.html`, render it in a browser at 1280x640 and 2x, then upload the new `social-preview.png` in the repository's Settings > General > Social preview. GitHub has no API for that upload. Discord and LINE keep old previews for a while after a change.
