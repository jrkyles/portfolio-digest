<#
.SYNOPSIS
  Creates the SharePoint list this dashboard reads from, with the exact INTERNAL column
  names the app expects, and optionally seeds it from the sample CSV.

.DESCRIPTION
  Column internal names matter more than display names here. sharePointDataFetcher.ts reads
  item.Year, item.Quarter, item.Project and so on straight off the REST response, and REST
  returns INTERNAL names. SharePoint derives the internal name from whatever the column is
  called at CREATION time and then freezes it - so a column created as "Due Month" is
  forever "Due_x0020_Month" internally, even if you rename the display name to "Month"
  afterwards. This script therefore creates every column with a clean, space-free name
  first, and only then sets a friendlier display title. Create these by hand in the UI and
  you will very likely end up with _x0020_ in the internal names and an app that silently
  renders nothing.

.PREREQUISITES
  PnP.PowerShell:  Install-Module PnP.PowerShell -Scope CurrentUser

.EXAMPLE
  ./Provision-PortfolioList.ps1 -SiteUrl "https://contoso.sharepoint.com/sites/Innovation"
  ./Provision-PortfolioList.ps1 -SiteUrl "https://..." -SeedFromCsv "../public/sample-timeline-data.csv"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SiteUrl,
  [string]$ListName = "Projects",
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
$columns = @(
  @{ Internal = "Year";        Display = "Year";                    Type = "Text" },
  @{ Internal = "Quarter";     Display = "Quarter";                 Type = "Text" },
  @{ Internal = "Month";       Display = "Month";                   Type = "Text" },
  @{ Internal = "Day";         Display = "Day";                     Type = "Text" },
  @{ Internal = "Team";        Display = "Team";                    Type = "Text" },
  @{ Internal = "Project";     Display = "Project";                 Type = "Text" },
  @{ Internal = "Status";      Display = "Status";                  Type = "Text" },
  @{ Internal = "Leads";       Display = "Leads";                   Type = "Note" },
  @{ Internal = "Effort";      Display = "Effort";                  Type = "Text" },
  @{ Internal = "Label";       Display = "Label";                   Type = "Text" },
  @{ Internal = "Departments"; Display = "Departments";             Type = "Text" },
  @{ Internal = "Description"; Display = "Description";             Type = "Note" }
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

# The stock 'Title' column is mandatory in SharePoint but unused by the app - Project is the
# real name field. Make Title optional so nobody has to fill in a duplicate.
Set-PnPField -List $ListName -Identity "Title" -Values @{ Required = $false } | Out-Null

# --- Optional seed ----------------------------------------------------------------------
if ($SeedFromCsv) {
  if (-not (Test-Path $SeedFromCsv)) { throw "CSV not found: $SeedFromCsv" }
  Write-Host "Seeding from $SeedFromCsv ..." -ForegroundColor Cyan
  $rows = Import-Csv -Path $SeedFromCsv
  foreach ($r in $rows) {
    Add-PnPListItem -List $ListName -Values @{
      Title       = $r.Project
      Year        = $r.Year
      Quarter     = $r.Quarter
      Month       = $r.Month
      Day         = $r.Day
      Team        = $r.Team
      Project     = $r.Project
      Status      = $r.Status
      Leads       = $r.Leads
      Effort      = $r.Effort
      Label       = $r.Label
      Departments = $r.Departments
      Description = $r.Description
    } | Out-Null
  }
  Write-Host ("Seeded {0} items." -f $rows.Count) -ForegroundColor Green
}

Write-Host "`nDone. List '$ListName' is ready at $SiteUrl" -ForegroundColor Green
Write-Host "Verify the app can read it:  <page-url>?list=$ListName" -ForegroundColor Cyan
