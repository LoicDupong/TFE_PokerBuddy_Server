# PokerBuddy ♠️
**Home poker nights, made simple.**

PokerBuddy is a full-stack web application designed to help players **organize, run, and track home poker sessions**.  
It centralizes everything needed before, during, and after a game night — from session creation to in-game tools, player stats, and a friends leaderboard.

---

## Why PokerBuddy?

Home poker nights are typically managed with:
- scattered Social Networks messages for invites
- manual blind timers on a phone
- paper notes or spreadsheets for results

PokerBuddy replaces all of that with **one clean, mobile-first app**.

---

## Features

### 🗓️ Session management
- Create, edit and manage poker sessions
- Configure buy-in, blinds, places paid, payout distribution
- View upcoming, active and past sessions
- Host-only controls (edit, invite, submit results)

### 👥 Player invites
- Invite registered friends or add guests by name
- Accept / decline game invites
- Real-time invite status per player (pending / accepted / refused)

### ⏱️ Live Game Manager
- Dedicated in-game screen for the host
- Blind timer with structured levels
- Player management during the session

### 🏆 Results & Statistics
- Host submits final rankings and prizes at end of game
- Per-player stats computed from actual game results:
  - Games played, Wins, Losses, Win rate
  - Best win streak, Paid places finishes
  - Average placement, Net result (€)

### 📊 Friends Leaderboard
- Ranks friends by: Net result → Wins → Average placement
- Compact view on homepage, full paginated view on `/leaderboard`
- Only shows players in your friends list

### 🤝 Friends system
- Search users by username
- Send, accept, decline friend requests
- Remove friends
- In-app friend invite notifications

### 🔔 Notifications
- In-app notifications for: game results, friend requests, game invites

### 👤 Profile
- Avatar upload, username, bio
- Public profile page per user
- Friends list with avatars

### 📖 Learn
- Poker rules reference
- Hand rankings
- Strategy basics
- Glossary

---

## Tech Stack

### Frontend
- **Next.js 15** (App Router, Turbopack)
- **React 19**
- **SCSS / Sass** — no Tailwind, custom design system
- **Zustand** — global state (auth, notifications, toasts)
- **Axios** — API client
- **FontAwesome** — icons
- **PWA** — installable, push notification support

### Backend
- **Express.js 5**
- **PostgreSQL** + **Sequelize 6** ORM
- **JWT** — authentication
- **Argon2** — password hashing
- **Multer** — avatar file uploads
- **Node.js ESM** (native `import/export`)

---

## Project Structure

```
TFE/
├── TFE_PokerBuddy_Client/   # Next.js frontend
│   └── src/
│       ├── app/             # Pages (App Router)
│       ├── components/      # Reusable UI components
│       ├── features/        # Feature-scoped components (modals, forms)
│       ├── services/        # API service layer (axios)
│       ├── stores/          # Zustand stores
│       └── ui/              # Layout components (header, footer, navbar)
│
└── TFE_PokerBuddy_Server/   # Express.js API
    └── src/
        ├── controllers/     # Route handlers
        ├── middlewares/     # Auth, upload
        ├── models/          # Sequelize models
        ├── routers/         # Express routers
        ├── seeder/          # Dev seed data
        └── utils/           # Shared utilities
```

---


## Project Context

PokerBuddy is a **Final Project (TFE)** developed as part of a **Full-Stack JavaScript training**.  
The goal was to deliver a **complete, usable product** within a limited timeframe, with a focus on:
- real-world features and usability
- clean REST API design
- mobile-first responsive UI
- maintainable codebase

---

## Status

✅ Core features complete and stable  
✅ Stats & leaderboard system live  
✅ Friends system with notifications  
✅ Avatar system  
✅ Toast feedback system (no more browser `alert()`)  
🚧 PWA push notifications (infrastructure ready, UX in progress)
