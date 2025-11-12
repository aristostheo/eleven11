
#!/usr/bin/env bash
set -euo pipefail

# Bootstrap git repo and (optionally) create GitHub repo via gh
if [ ! -d .git ]; then
  git init
  git add .
  git commit -m "chore: bootstrap eleven11 starter"
fi

if command -v gh >/dev/null 2>&1; then
  # Creates a private repo named eleven11 (change if taken)
  gh repo create eleven11 --private --source=. --remote=origin --push || true
else
  echo "GitHub CLI (gh) not found. Created local git repo. You can create a remote manually and run:"
  echo "  git remote add origin <your-remote-url>"
  echo "  git branch -M main && git push -u origin main"
fi
