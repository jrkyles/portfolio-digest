<#
.SYNOPSIS
  Creates a NEW SharePoint list matching this dashboard's schema, with clean internal column
  names, and optionally seeds it from the sample CSV.

.DESCRIPTION
  Only for standing up a list from scratch. If a list already exists (including one built by
  hand through the browser UI, with its own column names) - DO NOT run this against it. The
  app's data layer (sharePointDataFetcher.ts) now matches columns by a normalized,
  case/spacing/punctuation-insensitive lookup against a list of plausible names per field
  (e.g. the Project field accepts a column literally named "Project", "Task Name", or
  "TaskName"; Departments accepts "Departments" or "Department"; Label accepts "Label" or
  "Labels"), rather than requiring this script's exact internal names - so an existing,
  hand-built list with reasonably-named columns already works without being touched. This
  script's own column choices below mirror the real, currently-live list as closely as
  possible, for the case where you genuinely are creating a new one and want it to match.

  Column internal names still matter for a NEW list, though. sharePointDataFetcher.ts reads
  columns off the REST response, and REST returns INTERNAL names. SharePoint derives the
  internal name from whatever the column is called at CREATION time and then freezes it - so
  a column created as "Due Month" is forever "Due_x0020_Month" internally, even if you rename
  the display name to "Month" afterwards. This script creates every column with a clean,
  space-free internal name first, and only then sets a friendlier display title, so a fresh
  list this script creates never depends on the app's escaped-name fallback at all. (A column
  created by hand, with a space in its name, still works via that fallback - it just costs an
  extra normalization step at read time instead of being clean from the start.)

  There is no Month/Day/Year in the live list's real schema - it was replaced with Start
  date/Completed Date, neither of which the app currently reads (DetailPanel/PresentationMode
  fall back to an em dash when both are blank). This script matches that: no Month/Day/Year
  columns are created either.

.PREREQUISITES
  PnP.PowerShell:  Install-Module PnP.PowerShell -Scope CurrentUser

.EXAMPLE
  ./Provision-PortfolioList.ps1 -SiteUrl "https://contoso.sharepoint.com/sites/Innovation"
  ./Provision-PortfolioList.ps1 -SiteUrl "https://..." -SeedFromCsv "../public/sample-timeline-data.csv"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SiteUrl,
  [string]$ListName = "Status Report Tracking Information",
  [string]$SeedFromCsv
)

$ErrorActionPreference = "Stop"

Write-Host "Connecting to $SiteUrl ..." -ForegroundColor Cyan
Connect-PnPOnline -Url $SiteUrl -Interactive

# --- List -------------------------------------------------------------------------------
if (Get-PnPList -Identity $ListName -ErrorAction SilentlyContinue) {
  Write-Host "List '$ListName' already exists - reusing it." -ForegroundColor Yellow
} else {
  Write-Host "Creating list '$ListName' ..." -ForegroundColor Cyan
  New-PnPList -Title $ListName -Template GenericList -OnQuickLaunch | Out-Null
}

# --- Columns ----------------------------------------------------------------------------
# InternalName is what the app reads; DisplayName is only what humans see in the list UI.
# Choice columns are deliberately NOT used for Quarter/Team/Status: the app compares plain
# strings, and a Choice column that someone later edits is a silent breakage. Text keeps the
# contract obvious. Validation lives in the app (isValidProject) instead.
#
# Column set and display names mirror the real, currently-live list. Priority/Impact are on
# the live list but not yet read by the app anywhere - included here for schema parity (so a
# freshly-provisioned list has a place to put that data), not because anything consumes them.
$columns = @(
  @{ Internal = "Quarter";     Display = "Quarter";                 Type = "Number" },
  @{ Internal = "Status";      Display = "Status";                  Type = "Text" },
  @{ Internal = "Effort";      Display = "Effort";                  Type = "Text" },
  # Internal name TaskName (space-free) so this never depends on the app's escaped-name
  # fallback for a list this script creates - see the module-level comment above.
  @{ Internal = "TaskName";    Display = "Task Name";               Type = "Text" },
  @{ Internal = "Leads";       Display = "Leads";                   Type = "Note" },
  @{ Internal = "Department";  Display = "Department";              Type = "Note" },
  @{ Internal = "Description"; Display = "Description";             Type = "Note" },
  @{ Internal = "RisksIssues"; Display = "Risks / Issues";          Type = "Note" },
  @{ Internal = "BusinessPOC"; Display = "Business POC";            Type = "Note" },
  @{ Internal = "Team";        Display = "Team";                    Type = "Text" },
  @{ Internal = "Priority";    Display = "Priority";                Type = "Text" },
  @{ Internal = "Impact";      Display = "Impact";                  Type = "Text" },
  @{ Internal = "Labels";      Display = "Labels";                  Type = "Note" }
)

foreach ($c in $columns) {
  $existing = Get-PnPField -List $ListName -Identity $c.Internal -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host ("  = {0} (exists)" -f $c.Internal) -ForegroundColor DarkGray
    continue
  }
  Add-PnPField -List $ListName -DisplayName $c.Internal -InternalName $c.Internal `
               -Type $c.Type -AddToDefaultView | Out-Null
  if ($c.Display -ne $c.Internal) {
    Set-PnPField -List $ListName -Identity $c.Internal -Values @{ Title = $c.Display } | Out-Null
  }
  Write-Host ("  + {0}" -f $c.Internal) -ForegroundColor Green
}

# The stock 'Title' column is mandatory in SharePoint but unused by the app - TaskName is the
# real name field. Make Title optional so nobody has to fill in a duplicate.
Set-PnPField -List $ListName -Identity "Title" -Values @{ Required = $false } | Out-Null

# --- Optional seed ----------------------------------------------------------------------
# The sample CSV's own header still carries Year/Month/Day (it is this app's general-purpose
# fallback dataset, used for local dev regardless of which SharePoint schema is live) - those
# three columns simply aren't written here, since the list this script creates doesn't have
# them. $r.Departments/$r.Label read the CSV's own header names; Department/Labels on the
# right-hand side are this list's column names, which differ from the CSV's on purpose (see
# the module-level comment on why the app tolerates both).
if ($SeedFromCsv) {
  if (-not (Test-Path $SeedFromCsv)) { throw "CSV not found: $SeedFromCsv" }
  Write-Host "Seeding from $SeedFromCsv ..." -ForegroundColor Cyan
  $rows = Import-Csv -Path $SeedFromCsv
  foreach ($r in $rows) {
    Add-PnPListItem -List $ListName -Values @{
      Title       = $r.Project
      Quarter     = $r.Quarter
      TaskName    = $r.Project
      Status      = $r.Status
      Leads       = $r.Leads
      Effort      = $r.Effort
      Labels      = $r.Label
      Department  = $r.Departments
      Description = $r.Description
      BusinessPOC = $r.BusinessPOC
      RisksIssues = $r.RisksIssues
      Team        = $r.Team
    } | Out-Null
  }
  Write-Host ("Seeded {0} items." -f $rows.Count) -ForegroundColor Green
}

Write-Host "`nDone. List '$ListName' is ready at $SiteUrl" -ForegroundColor Green
Write-Host "Verify the app can read it:  <page-url>?list=$ListName" -ForegroundColor Cyan
