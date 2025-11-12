
# 11:11 — Time‑Gated Social Collage (Starter)

Playful social app that only unlocks at 11:11 (am/pm). This starter includes:
- Expo React Native (TypeScript) app scaffold with Expo Router
- Firebase initialization hook points
- Firebase Functions (TypeScript) with stubs for time‑gating + post submission
- Security rules (Firestore + Storage)
- Git + GitHub bootstrap script
- Issue templates

## Quick Start

### 0) Requirements
- Node 18+ and pnpm or npm
- Expo CLI (`npm i -g expo` recommended) and EAS CLI (`npm i -g eas-cli`) optional
- Firebase CLI (`npm i -g firebase-tools`)
- (Optional) GitHub CLI `gh`

### 1) Install deps
```bash
cd apps/mobile && pnpm i
cd ../../functions && pnpm i
```

### 2) Firebase project
Create a Firebase project, then replace `your-firebase-project-id` in `.firebaserc`.
Enable **Auth (Anonymous)**, **Firestore**, **Storage**.

```bash
firebase login
firebase use your-firebase-project-id
firebase emulators:start
```

### 3) Add mobile Firebase config
In the Firebase console → Project settings → Web app → copy config and paste into `apps/mobile/src/lib/firebase.ts` where indicated.

### 4) Run the app (Expo)
```bash
cd apps/mobile
pnpm start
```

### 5) Deploy functions (after editing project id)
```bash
firebase deploy --only functions,hosting,firestore:rules,storage
```

### 6) Create GitHub repo (optional, with gh)
From repo root:
```bash
./scripts/setup.sh
```

## Structure
```
eleven11/
  apps/mobile/            # Expo RN app
  functions/              # Firebase Functions (TS)
  firestore.rules         # Firestore security rules
  storage.rules           # Storage security rules
  firebase.json           # Firebase config
  .firebaserc             # Set your project id here
  .github/ISSUE_TEMPLATE  # GitHub issue templates
  scripts/setup.sh        # Git + GitHub bootstrap
```

## License
MIT
