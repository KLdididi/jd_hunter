@echo off
chcp 65001 >nul
echo Starting Edge with CDP debugging port 9222...
start "" "msedge" --remote-debugging-port=9222 --user-data-dir="%TEMP%\edge-cdp-profile" --no-first-run --no-default-browser-check
echo.
echo Edge launched! Please log in to zhipin.com in the browser.
echo Then come back to JD Hunter and click "Start Crawl".
echo.
pause
