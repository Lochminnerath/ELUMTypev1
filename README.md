# Health Manager

Health Manager is a white-themed nutrition and wellness service that tracks calories, macros, exercise, sleep, streaks, and evening reflection.

## Features
- Food catalog of 3,200 items across 16 food groups with calories, protein, fat, carbs, fiber, sugar, and sodium.
- Standard food logging and quick-add calories (preset averages and custom calorie entry).
- "Should I eat this?" calorie-fit check against daily goal.
- Exercise logging that increases available calories (net calories = intake - burn).
- Sleep logging.
- Evening questionnaire unlocked after the fasting cutoff time (default 7:00 PM local time) for:
  - 3 strengths
  - 1 weakness to improve tomorrow
  - Mental health check (mood, stress, anxiety, notes)
- Streak counter for consecutive days meeting goal.

## Run
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Then open http://127.0.0.1:8000

## Notes
- This project uses SQLite (`health_manager.db`) and automatically seeds the food catalog at startup.
- You can edit timezone and fasting cutoff hour in settings.

## Netlify deployment

This project runs on Netlify using a Python Function wrapper for FastAPI.

- Function entrypoint: `netlify/functions/api.py`
- Routing: `netlify.toml` rewrites all paths (`/*`) to `/.netlify/functions/api`

If you saw a Netlify 404 previously, this setup fixes it by explicitly declaring the functions directory and redirect rules.
