# bkk-tools — temp deploy route

Throwaway public repo serving the bkk organizer-views tool to the browser.
Source of truth lives in the LeafSorter skill folder
(`wa_sites/bosveldkunste/exports/organizer-views.js`); this repo is only the
delivery pipe. `./deploy.sh` = copy → commit → push.

## Load on the page

Signed in on `bosveldkunste.co.za/admin-entries`, run (console or bookmarklet):

```js
fetch('https://raw.githubusercontent.com/redbirdlife/bkk-tools/main/organizer-views.js?' + Date.now())
  .then(r => r.text()).then(eval)
```

The tool is read-only against the site; auth rides the existing admin token in
localStorage. No secrets in this repo — keep it that way (it is public).

Retire the repo when data collections v2 ships.
