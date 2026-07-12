@echo off
REM Script per pubblicare le modifiche: aggiunge tutto, fa il commit con un
REM messaggio fisso e fa il push su GitHub (Vercel fa il deploy in automatico).

cd /d "%~dp0"

git add -A
git commit -m "Aggiornamento app orario scolastico"
git push

echo.
echo Fatto. Premi un tasto per chiudere.
pause >nul
