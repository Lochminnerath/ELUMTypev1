from __future__ import annotations

import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
import os
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = os.getenv("HEALTH_MANAGER_DB_PATH", "/tmp/health_manager.db" if os.getenv("NETLIFY") else str(BASE_DIR / "health_manager.db"))
DEFAULT_TIMEZONE = "America/New_York"
QUICK_ADD_OPTIONS = [
    ("Quick Snack", 180),
    ("Quick Meal", 450),
    ("Protein Shake", 220),
    ("Coffee Drink", 160),
    ("Dessert", 320),
]
FOOD_GROUPS = [
    "Fruit",
    "Vegetable",
    "Whole Grain",
    "Legume",
    "Dairy",
    "Egg",
    "Seafood",
    "Poultry",
    "Red Meat",
    "Plant Protein",
    "Nuts",
    "Seeds",
    "Healthy Fat",
    "Beverage",
    "Prepared Meal",
    "Snack",
]

app = FastAPI(title="Health Manager")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@dataclass
class DailySummary:
    consumed: float
    burned: float
    goal: float

    @property
    def net(self) -> float:
        return self.consumed - self.burned

    @property
    def remaining(self) -> float:
        return self.goal - self.net


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS profile (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                calorie_goal INTEGER NOT NULL DEFAULT 2000,
                timezone TEXT NOT NULL DEFAULT 'America/New_York',
                fasting_cutoff INTEGER NOT NULL DEFAULT 19
            );

            INSERT OR IGNORE INTO profile(id, calorie_goal, timezone, fasting_cutoff)
            VALUES(1, 2000, 'America/New_York', 19);

            CREATE TABLE IF NOT EXISTS food_items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                group_name TEXT NOT NULL,
                calories REAL NOT NULL,
                protein REAL NOT NULL,
                fat REAL NOT NULL,
                carbs REAL NOT NULL,
                fiber REAL NOT NULL,
                sugar REAL NOT NULL,
                sodium REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS food_log (
                id INTEGER PRIMARY KEY,
                entry_date TEXT NOT NULL,
                food_id INTEGER,
                food_name TEXT NOT NULL,
                calories REAL NOT NULL,
                protein REAL NOT NULL,
                fat REAL NOT NULL,
                carbs REAL NOT NULL,
                quantity REAL NOT NULL,
                custom INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(food_id) REFERENCES food_items(id)
            );

            CREATE TABLE IF NOT EXISTS exercise_log (
                id INTEGER PRIMARY KEY,
                entry_date TEXT NOT NULL,
                exercise_name TEXT NOT NULL,
                duration_minutes REAL NOT NULL,
                calories_burned REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sleep_log (
                id INTEGER PRIMARY KEY,
                entry_date TEXT NOT NULL,
                hours REAL NOT NULL,
                quality INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS questionnaire_log (
                id INTEGER PRIMARY KEY,
                entry_date TEXT NOT NULL UNIQUE,
                strength_1 TEXT,
                strength_2 TEXT,
                strength_3 TEXT,
                weakness_focus TEXT,
                mood_score INTEGER,
                stress_score INTEGER,
                anxiety_score INTEGER,
                notes TEXT,
                completed_at TEXT
            );
            """
        )
    seed_foods()


def seed_foods() -> None:
    with db() as conn:
        current_count = conn.execute("SELECT COUNT(*) AS c FROM food_items").fetchone()["c"]
        if current_count >= 3200:
            return

        conn.execute("DELETE FROM food_items")
        rows = []
        item_id = 1
        for group_idx, group in enumerate(FOOD_GROUPS):
            for item_idx in range(1, 201):
                calories = 55 + ((group_idx * 31 + item_idx * 7) % 420)
                protein = round(2.5 + ((group_idx * 5 + item_idx * 3) % 42) / 2.8, 1)
                fat = round(1.2 + ((group_idx * 9 + item_idx * 2) % 35) / 3.5, 1)
                carbs = round(5 + ((group_idx * 11 + item_idx * 4) % 65) / 1.8, 1)
                fiber = round(0.8 + ((group_idx * 3 + item_idx) % 15) / 2.2, 1)
                sugar = round(0.5 + ((group_idx * 7 + item_idx * 2) % 20) / 2.8, 1)
                sodium = round(20 + ((group_idx * 37 + item_idx * 13) % 900), 1)
                name = f"{group} Item {item_idx:03d}"
                rows.append(
                    (
                        item_id,
                        name,
                        group,
                        calories,
                        protein,
                        fat,
                        carbs,
                        fiber,
                        sugar,
                        sodium,
                    )
                )
                item_id += 1

        conn.executemany(
            """
            INSERT INTO food_items(
                id, name, group_name, calories, protein, fat, carbs, fiber, sugar, sodium
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )


def get_profile() -> sqlite3.Row:
    with db() as conn:
        return conn.execute("SELECT * FROM profile WHERE id = 1").fetchone()


def today_local(tz: str) -> date:
    return datetime.now(ZoneInfo(tz)).date()


def evening_window(profile: sqlite3.Row) -> bool:
    local_time = datetime.now(ZoneInfo(profile["timezone"]))
    return local_time.hour >= profile["fasting_cutoff"]


def daily_summary(entry_date: str, goal: int) -> DailySummary:
    with db() as conn:
        consumed = conn.execute(
            "SELECT COALESCE(SUM(calories), 0) AS c FROM food_log WHERE entry_date = ?", (entry_date,)
        ).fetchone()["c"]
        burned = conn.execute(
            "SELECT COALESCE(SUM(calories_burned), 0) AS c FROM exercise_log WHERE entry_date = ?", (entry_date,)
        ).fetchone()["c"]
    return DailySummary(consumed=consumed, burned=burned, goal=goal)


def streak_count(goal: int, tz: str) -> int:
    today = today_local(tz)
    streak = 0
    day_cursor = today
    while True:
        summary = daily_summary(day_cursor.isoformat(), goal)
        if summary.consumed <= 0 or summary.net > goal:
            break
        streak += 1
        day_cursor = date.fromordinal(day_cursor.toordinal() - 1)
    return streak


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/", response_class=HTMLResponse)
def home(request: Request, selected_food: int | None = None, quantity: float = 1.0):
    profile = get_profile()
    today = today_local(profile["timezone"]).isoformat()
    summary = daily_summary(today, profile["calorie_goal"])

    with db() as conn:
        foods = conn.execute(
            "SELECT * FROM food_items ORDER BY group_name, name LIMIT 400"
        ).fetchall()
        groups = conn.execute(
            "SELECT group_name, COUNT(*) AS c FROM food_items GROUP BY group_name ORDER BY group_name"
        ).fetchall()
        food_logs = conn.execute(
            "SELECT * FROM food_log WHERE entry_date = ? ORDER BY id DESC LIMIT 25", (today,)
        ).fetchall()
        exercise_logs = conn.execute(
            "SELECT * FROM exercise_log WHERE entry_date = ? ORDER BY id DESC LIMIT 20", (today,)
        ).fetchall()
        sleep_entry = conn.execute(
            "SELECT * FROM sleep_log WHERE entry_date = ? ORDER BY id DESC LIMIT 1", (today,)
        ).fetchone()
        questionnaire = conn.execute(
            "SELECT * FROM questionnaire_log WHERE entry_date = ?", (today,)
        ).fetchone()

    recommendation = None
    if selected_food:
        food = next((f for f in foods if f["id"] == selected_food), None)
        if food:
            projected_net = summary.net + (food["calories"] * quantity)
            if projected_net <= profile["calorie_goal"]:
                recommendation = f"Good fit. Projected remaining calories: {profile['calorie_goal'] - projected_net:.0f}"
            else:
                recommendation = f"Over target by {projected_net - profile['calorie_goal']:.0f}. Consider a lower-calorie option."

    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "profile": profile,
            "summary": summary,
            "foods": foods,
            "groups": groups,
            "food_logs": food_logs,
            "exercise_logs": exercise_logs,
            "sleep_entry": sleep_entry,
            "quick_options": QUICK_ADD_OPTIONS,
            "recommendation": recommendation,
            "show_questionnaire": evening_window(profile),
            "questionnaire": questionnaire,
            "streak": streak_count(profile["calorie_goal"], profile["timezone"]),
            "today": today,
        },
    )


@app.post("/add-food")
def add_food(food_id: int = Form(...), quantity: float = Form(1.0)):
    profile = get_profile()
    today = today_local(profile["timezone"]).isoformat()
    with db() as conn:
        food = conn.execute("SELECT * FROM food_items WHERE id = ?", (food_id,)).fetchone()
        if food:
            conn.execute(
                """
                INSERT INTO food_log(entry_date, food_id, food_name, calories, protein, fat, carbs, quantity, custom)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                """,
                (
                    today,
                    food_id,
                    food["name"],
                    food["calories"] * quantity,
                    food["protein"] * quantity,
                    food["fat"] * quantity,
                    food["carbs"] * quantity,
                    quantity,
                ),
            )
    return RedirectResponse(url="/", status_code=303)


@app.post("/quick-add")
def quick_add(name: str = Form(...), calories: float = Form(...)):
    profile = get_profile()
    today = today_local(profile["timezone"]).isoformat()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO food_log(entry_date, food_name, calories, protein, fat, carbs, quantity, custom)
            VALUES (?, ?, ?, 0, 0, 0, 1, 1)
            """,
            (today, name, calories),
        )
    return RedirectResponse(url="/", status_code=303)


@app.post("/add-exercise")
def add_exercise(exercise_name: str = Form(...), duration_minutes: float = Form(...), calories_burned: float = Form(...)):
    profile = get_profile()
    today = today_local(profile["timezone"]).isoformat()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO exercise_log(entry_date, exercise_name, duration_minutes, calories_burned)
            VALUES (?, ?, ?, ?)
            """,
            (today, exercise_name, duration_minutes, calories_burned),
        )
    return RedirectResponse(url="/", status_code=303)


@app.post("/save-sleep")
def save_sleep(hours: float = Form(...), quality: int = Form(...)):
    profile = get_profile()
    today = today_local(profile["timezone"]).isoformat()
    with db() as conn:
        conn.execute(
            "INSERT INTO sleep_log(entry_date, hours, quality) VALUES (?, ?, ?)",
            (today, hours, quality),
        )
    return RedirectResponse(url="/", status_code=303)


@app.post("/save-questionnaire")
def save_questionnaire(
    strength_1: str = Form(...),
    strength_2: str = Form(...),
    strength_3: str = Form(...),
    weakness_focus: str = Form(...),
    mood_score: int = Form(...),
    stress_score: int = Form(...),
    anxiety_score: int = Form(...),
    notes: str = Form(""),
):
    profile = get_profile()
    today = today_local(profile["timezone"]).isoformat()
    now = datetime.now(ZoneInfo(profile["timezone"])).isoformat()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO questionnaire_log(
                entry_date, strength_1, strength_2, strength_3, weakness_focus,
                mood_score, stress_score, anxiety_score, notes, completed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entry_date) DO UPDATE SET
                strength_1=excluded.strength_1,
                strength_2=excluded.strength_2,
                strength_3=excluded.strength_3,
                weakness_focus=excluded.weakness_focus,
                mood_score=excluded.mood_score,
                stress_score=excluded.stress_score,
                anxiety_score=excluded.anxiety_score,
                notes=excluded.notes,
                completed_at=excluded.completed_at
            """,
            (today, strength_1, strength_2, strength_3, weakness_focus, mood_score, stress_score, anxiety_score, notes, now),
        )
    return RedirectResponse(url="/", status_code=303)


@app.post("/settings")
def save_settings(calorie_goal: int = Form(...), timezone: str = Form(...), fasting_cutoff: int = Form(...)):
    with db() as conn:
        conn.execute(
            "UPDATE profile SET calorie_goal = ?, timezone = ?, fasting_cutoff = ? WHERE id = 1",
            (calorie_goal, timezone, fasting_cutoff),
        )
    return RedirectResponse(url="/", status_code=303)
