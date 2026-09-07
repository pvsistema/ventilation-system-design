# Compares the local core version (SERVER_VERSION) with the one published in the
# cloud and tells build.bat whether it is safe to build.
#
# WHY A SEPARATE FILE. The same logic inlined into build.bat needs every
# > < ^ & | character escaped for cmd. One unescaped ">" is treated as output
# redirection and kills the whole .bat instantly: the console window blinks and
# closes with no message. A .ps1 file has no such rules.
#
# WHY THE CHECK MATTERS. On startup PVS.exe compares server\server_version.txt
# with server_version from the cloud. If the numbers differ it DOWNLOADS the
# published server.exe over the freshly built one. So a local number lower than
# (or equal to) the published one means the app silently runs the OLD core -
# the build looks broken while the real cause is a version mismatch.
#
# Usage:  powershell -File check_core_version.ps1 <local-version>
# Output: one line "OK|<published>" / "LOW|<published>" / "" (no network)

param([string]$Local)

$Url = 'https://functions.poehali.dev/0ddfea8a-386f-4cb2-9fe0-37274caf2e16'

try {
    $resp = Invoke-RestMethod -TimeoutSec 15 -Uri $Url
    $published = [string]$resp.server_version
} catch {
    # No network / service unavailable: stay silent so the build still works
    # on a machine without internet.
    exit 0
}

if ([string]::IsNullOrWhiteSpace($published)) { exit 0 }

try {
    # Compare as numbers, not as text: "1.0.6" is LOWER than "1.0.51",
    # although as strings "6" sorts after "51".
    if ([version]$Local -gt [version]$published) {
        Write-Output "OK|$published"
    } else {
        Write-Output "LOW|$published"
    }
} catch {
    # Unparsable version - do not block the build.
    exit 0
}
