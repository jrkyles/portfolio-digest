INNOVATION PORTFOLIO DIGEST — SHAREPOINT SETUP
==============================================

There is one file to deploy: InnovationPortfolioDigest.html

It is fully self-contained. The JavaScript, styling, Federal Reserve seal and offline
sample data are all inlined into that single file. It loads no CDN, no fonts, and no
sibling files. Nothing needs to be compiled, installed, or built.


WHAT IT DOES
------------
It reads the SharePoint list "Status Report Tracking Information" on whatever site it is
uploaded to, and renders it as a timeline / quarterly report. It only ever reads. It never
writes to the list.

Because it calls SharePoint using a relative path, it authenticates as whoever is already
signed in to SharePoint. There are no credentials, no secrets, no app registration, and no
permissions to grant. A viewer sees exactly the rows their own list permissions allow.


TWO THINGS ARE REQUIRED
-----------------------
1. The list must exist on the site, with the exact column internal names in the schema.
   scripts/Provision-PortfolioList.ps1 creates it correctly in one command. Creating the
   columns by hand is the most common cause of "it loads but shows nothing", because
   SharePoint permanently freezes a column's internal name at creation time — a column
   first created as "Due Month" stays "Due_x0020_Month" forever, even after renaming.

2. The HTML file must be uploaded to the SAME site as that list (Site Assets is the usual
   place). Same-site is what makes the relative API call work; hosted elsewhere it is
   cross-origin and will fail.


MAKING IT REACHABLE — the only tenant-dependent step
----------------------------------------------------
SharePoint Online does not render arbitrary .html from a document library by default.

Upload the file and open its URL:

  - If it RENDERS: you are done. Share that URL.

  - If it DOWNLOADS instead: custom script is blocked on this site. Either enable it for
    this one site —

        Set-PnPTenantSite -Url <site-url> -NoScriptSite $false

    — or add an Embed web part to a modern SharePoint page pointing at the file's URL.


IF IT LOADS BUT SHOWS NO TASKS
------------------------------
Open the browser console (F12). The app logs exactly what it tried and what came back.

  - "list not found"        -> the list name or the site is wrong
  - rows fetched but empty  -> Quarter values are not 1-4 (see below)
  - a permissions error     -> the viewer cannot read the list

A row is intentionally hidden when its Quarter is 0, blank, or anything outside 1-4. That
is the supported way to park a task in the tracker before it has been scheduled — it stays
out of the report until a real quarter is assigned. Everything else about the row is left
untouched.


POINTING IT AT A DIFFERENT LIST
-------------------------------
Append ?list=<List Display Name> to the URL. No rebuild needed.
