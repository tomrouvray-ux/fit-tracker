# FitTrack

A health and fitness tracker that runs in the browser and installs as an app on your phone. It logs gym workouts the way openGym does, keeps a food diary like MyFitnessPal, logs a meal from a photo with Claude, and pulls in your Garmin activities.

Your data stays on your device. There is no server and no account.

## Features

**Train**
- Routines for each weekday, with three starter plans (Push/Pull/Legs, Upper/Lower, Full Body) that you can edit.
- Guided sessions: weights and reps carry over from last time, a rest timer runs after each set and beeps when it ends, and the screen stays awake.
- Detects personal records from estimated 1RM, marks warm-up sets, and lets you add, swap and reorder exercises mid-session.
- A library of 870+ exercises with animated demos (the start and end photos play like a GIF) and how-to steps, searchable by muscle and equipment. You can add your own exercises too.

**Food**
- A daily diary for breakfast, lunch, dinner and snacks, with calories left (goal − food + exercise) and protein, carbs and fat.
- Search about 3,000 everyday UK foods instantly (works offline), plus UK products from Open Food Facts and generic foods from USDA FoodData Central. Scan a barcode, or reuse recent and saved foods.
- **Photo logging:** take a photo of your plate or a label and Claude lists each item with an estimated portion and macros. You check and adjust the grams before anything is saved. You can also type what you ate ("2 eggs on toast") and Claude estimates it.
- Quick add, copy a meal from yesterday, and a water tracker.
- A calorie goal calculator (Mifflin–St Jeor).

**Activity (Garmin)**
- Syncs activities, steps, sleep, resting HR, HRV and weight from Garmin through [Intervals.icu](https://intervals.icu). It syncs when the app opens and when you tap Sync.
- You can also import `.fit`, `.zip` (Garmin Connect's "Export Original"), `.gpx` and `.tcx` files, or add an activity by hand.
- Garmin calories can count toward your daily food budget.

**Today**
- A "This week" strip: tap a day to see the workout you did or have planned, and start today's routine from there.
- A muscle map with three views: balance (sets per muscle over a week, 30 or 90 days), fatigue (recent sets, recovering over about three days) and strength (change in estimated 1RM over the last 30 days).

**Progress**
- Body weight trend, calories over the last 14 days, training hours per week, a 26-week consistency heatmap and recent PRs.

## Setup

1. **Host it.** In this repo go to Settings → Pages, set Source to "Deploy from a branch", pick `main` and `/ (root)`, then save. The app goes live at `https://tomrouvray-ux.github.io/fit-tracker/`.
2. **Install it.** On an iPhone, open the link in Safari, tap Share, then Add to Home Screen. On a Mac in Chrome, use Install in the address bar.
3. **Claude key, for photo logging.** Create an API key at [platform.claude.com](https://platform.claude.com/settings/keys) and paste it into Settings → AI food photos. Each photo costs about a cent.
4. **Garmin.** Sign up free at [intervals.icu](https://intervals.icu), connect Garmin Connect in its settings, then copy the API key and athlete ID from Developer Settings into FitTrack's Settings → Garmin.

5. **Sync between phone and computer (optional).** [Create a GitHub token](https://github.com/settings/tokens/new?scopes=gist&description=FitTrack%20sync) with only the `gist` scope and paste it into Settings → Sync between devices on each device.

Garmin only gives its official API to approved companies, which is why the app goes through Intervals.icu.

## Your data

Everything is saved in the browser on the device you use, in IndexedDB. Use Settings → Export backup now and then, and Import backup to move to a new phone. Backups leave out your API keys.

With sync on, the app also keeps a copy in a private Gist called "FitTrack sync" on your GitHub account. It syncs when the app opens and a few seconds after each change. Each sync merges this device, the Gist and the last copy both agreed on, so food, workouts and weights added or deleted on either device are kept. If the same item is edited on both devices before they sync, this device's version wins. API keys and the in-progress workout stay on each device.

## Running locally

It is a static site with no build step:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Credits

- Exercises: [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain).
- Food data: McCance and Widdowson's [Composition of Foods Integrated Dataset](https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid) (Open Government Licence v3.0), built into `data/foods-uk.json` by `tools/build_cofid.py`; [Open Food Facts](https://world.openfoodfacts.org) (ODbL); [USDA FoodData Central](https://fdc.nal.usda.gov) (public domain).
- Body map shapes: [react-body-highlighter](https://github.com/GV79/react-body-highlighter) (MIT).
- Workout flow inspired by [openGym](https://github.com/DuarteSantos8/openGym).
